"use strict";

const { AsyncLocalStorage } = require("node:async_hooks");
const context = new AsyncLocalStorage();
const keys = [
  "content_street_infos_v1",
  "content_lists_v1",
  "content_monuments_v1",
];

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function readSettings(client) {
  const { rows } = await client.query(
    "SELECT key, value_text FROM app_settings WHERE key = ANY($1::text[]) ORDER BY key",
    [keys],
  );
  return Object.fromEntries(rows.map((row) => [row.key, row.value_text]));
}

async function readRevision(client) {
  const { rows } = await client.query(
    "SELECT revision FROM admin_content_state WHERE id=1",
  );
  return rows[0].revision;
}

async function edit(pool, expectedRevision, actor, action, operation) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw httpError(
      428,
      "Actualisez le contenu avant de l’enregistrer. Votre saisie est conservée.",
    );
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT revision FROM admin_content_state WHERE id=1 FOR UPDATE",
    );
    const revision = await readRevision(client);
    if (revision !== expectedRevision) {
      throw httpError(
        409,
        "Le contenu a été modifié depuis son ouverture. Copiez votre saisie puis actualisez avant de réessayer.",
      );
    }
    const before = await readSettings(client);
    const payload = await context.run(client, operation);
    const after = await readSettings(client);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      await client.query(
        `INSERT INTO admin_content_revisions(actor_username,action,before_settings,after_settings)
         VALUES($1,$2,$3::jsonb,$4::jsonb)`,
        [actor, action, JSON.stringify(before), JSON.stringify(after)],
      );
      await client.query(
        "UPDATE admin_content_state SET revision=revision+1 WHERE id=1",
      );
    }
    const nextRevision = await readRevision(client);
    await client.query("COMMIT");
    return { ...payload, revision: nextRevision };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function snapshot(pool, operation) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const payload = await context.run(client, operation);
    const revision = await readRevision(client);
    await client.query("COMMIT");
    return { ...payload, revision };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function restore(pool, id, expectedRevision, actor) {
  return edit(
    pool,
    expectedRevision,
    actor,
    `Restaurer la révision ${id}`,
    async () => {
      const client = context.getStore();
      const { rows } = await client.query(
        "SELECT before_settings FROM admin_content_revisions WHERE id=$1",
        [id],
      );
      if (!rows[0]) throw httpError(404, "Révision introuvable");
      for (const key of keys) {
        if (Object.hasOwn(rows[0].before_settings, key)) {
          await client.query(
            `INSERT INTO app_settings(key,value_text) VALUES($1,$2)
           ON CONFLICT(key) DO UPDATE SET value_text=EXCLUDED.value_text,updated_at=NOW()`,
            [key, rows[0].before_settings[key]],
          );
        } else {
          await client.query("DELETE FROM app_settings WHERE key=$1", [key]);
        }
      }
      return { success: true };
    },
  );
}

module.exports = {
  context,
  edit,
  snapshot,
  restore,
  httpError,
  keys,
  readSettings,
};
