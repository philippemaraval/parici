"use strict";
const { httpError, readSettings } = require("./content");
const crypto = require("node:crypto");
const text = (v, max = 4000) =>
  String(v ?? "")
    .trim()
    .slice(0, max);
const kinds = ["daily", "explorer", "card", "street", "event"];
function dateKey(v) {
  try {
    return (
      typeof v === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(v) &&
      new Date(v + "T12:00:00Z").toISOString().slice(0, 10) === v
    );
  } catch {
    return false;
  }
}
function image(v) {
  if (!v) return null;
  try {
    if (/^\/data\/[\w/.-]+$/.test(v)) return v;
    const u = new URL(v);
    if (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      v.length <= 2048
    )
      return v;
  } catch {}
  throw httpError(400, "URL image HTTPS ou fichier local requis.");
}
function validate(kind, p) {
  if (!kinds.includes(kind) || !p || typeof p !== "object" || Array.isArray(p))
    throw httpError(400, "Brouillon invalide.");
  if (kind === "daily") {
    if (
      !dateKey(p.date) ||
      !text(p.street_name) ||
      !text(p.quartier || p.arrondissement)
    )
      throw httpError(400, "Date, rue et quartier requis.");
    if (
      !Array.isArray(p.coordinates) ||
      p.coordinates.length !== 2 ||
      !p.coordinates.every(Number.isFinite) ||
      p.coordinates[0] < -180 ||
      p.coordinates[0] > 180 ||
      p.coordinates[1] < -90 ||
      p.coordinates[1] > 90
    )
      throw httpError(400, "Coordonnées [longitude, latitude] invalides.");
    if (!p.verified || !p.image_url || /\.svg(?:[?#]|$)/i.test(p.image_url))
      throw httpError(
        400,
        "Vérifiez la photo et les coordonnées avant de préparer cette cible.",
      );
    return {
      date: p.date,
      street_name: text(p.street_name, 200),
      quartier: text(p.quartier || p.arrondissement, 200),
      coordinates: p.coordinates,
      image_url: image(p.image_url),
    };
  }
  if (kind === "explorer") {
    const r = require("../explorer/validation").normalizeRiddlePayload(p);
    if (!r.ok) throw httpError(400, r.error);
    return Object.fromEntries(
      [
        "way_id",
        "street_name_clean",
        "riddle_text",
        "hint_text",
        "explanation_text",
        "image_url",
        "latitude",
        "longitude",
      ].map((k, i) => [k, r.values[i]]),
    );
  }
  if (kind === "card")
    return {
      description_override: text(p.description_override, 500) || null,
      description_full_override: text(p.description_full_override) || null,
      image_override: image(p.image_override),
      image_credit_override: text(p.image_credit_override, 500) || null,
    };
  if (kind === "street") {
    if (
      !["famous", "main"].includes(p.mode) ||
      !text(p.name) ||
      !text(p.description)
    )
      throw httpError(400, "Catégorie, rue et description requises.");
    return {
      mode: p.mode,
      name: text(p.name, 200).toLowerCase(),
      description: text(p.description),
    };
  }
  if (
    !dateKey(p.week_start) ||
    new Date(p.week_start + "T12:00Z").getUTCDay() !== 1 ||
    !Array.isArray(p.objectives) ||
    p.objectives.length < 2 ||
    p.objectives.length > 3
  )
    throw httpError(400, "Choisissez un lundi et deux ou trois objectifs.");
  const valid = [
    "arrondissement",
    "quartier",
    "famous",
    "main",
    "monument",
    "bus",
    "district",
  ];
  if (
    p.objectives.some(
      (o) =>
        !valid.includes(o.kind) ||
        !Number.isInteger(o.target) ||
        o.target < 1 ||
        o.target > 100,
    ) ||
    new Set(p.objectives.map((o) => o.kind)).size !== p.objectives.length
  )
    throw httpError(400, "Objectifs invalides ou doublonnés.");
  return {
    week_start: p.week_start,
    objectives: p.objectives.map((o, i) => ({
      kind: o.kind,
      target: o.target,
      label: text(o.label || o.kind, 200),
      position: i + 1,
    })),
  };
}
async function snapshot(c, kind, key, p, lock = false) {
  if (kind === "explorer" && key === "new") return null;
  if (["explorer", "card", "daily"].includes(kind)) {
    const tables = {
      explorer: "explorer_riddles",
      card: "cards",
      daily: "daily_targets",
    };
    return (
      (
        await c.query(
          `SELECT * FROM ${tables[kind]} WHERE ${kind === "daily" ? "date" : "id"}=$1${lock ? " FOR UPDATE" : ""}`,
          [key],
        )
      ).rows[0] || null
    );
  }
  if (kind === "event")
    return (
      (
        await c.query("SELECT * FROM admin_events WHERE week_start=$1", [
          p.week_start,
        ])
      ).rows[0] || null
    );
  const setting = (
    await c.query(
      "SELECT value_text FROM app_settings WHERE key='content_street_infos_v1'",
    )
  ).rows[0];
  const infos = setting ? JSON.parse(setting.value_text) : {};
  return { value: infos[p.mode]?.[p.name] ?? null };
}
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonical(v[k])]),
    );
  return v;
}
const fingerprint = (v) =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify(canonical(JSON.parse(JSON.stringify(v)))))
    .digest("hex");
async function eventPreview(c, p) {
  const cards = (
    await c.query(
      "SELECT id AS card_id,family,name FROM cards WHERE status='active' AND catalog_present AND NOT EXISTS(SELECT 1 FROM collect_card_merges WHERE source_card_id=cards.id)",
    )
  ).rows;
  const weekly = require("../collect/weekly-challenge"),
    meta = weekly.streetMetadata(
      JSON.parse(
        (
          await c.query(
            "SELECT value_text FROM app_settings WHERE key='content_lists_v1'",
          )
        ).rows[0]?.value_text || "{}",
      ),
    );
  const dimensions = cards.map((card) => ({
    ...card,
    ...(card.family === "street"
      ? meta.get(weekly.normalize(card.name))
      : null),
  }));
  const objectives = p.objectives.map((o) => ({
    ...o,
    available: new Set(
      dimensions.map((d) => weekly.unitKey(o.kind, d)).filter(Boolean),
    ).size,
  }));
  if (objectives.some((o) => o.target > o.available))
    throw httpError(400, "Un objectif dépasse le catalogue jouable.");
  return {
    objectives,
    reward: require("../collect/weekly-rewards").rewardPolicy(p.objectives),
    cards: cards.length,
  };
}
async function checkPublish(c, d) {
  if (["daily", "event"].includes(d.kind)) {
    const day = (
      await c.query(
        "SELECT to_char(NOW() AT TIME ZONE 'Europe/Paris','YYYY-MM-DD') AS day",
      )
    ).rows[0].day;
    const target = d.kind === "daily" ? d.payload.date : d.payload.week_start;
    if (target <= day)
      throw httpError(
        409,
        "Seules les journées ou semaines futures peuvent être publiées.",
      );
  }
  const current = await snapshot(c, d.kind, d.entity_key, d.payload, true);
  if (fingerprint(current) !== fingerprint(d.base_snapshot))
    throw httpError(
      409,
      "Le contenu publié a changé : recréez le brouillon après comparaison.",
    );
  if (d.kind === "event") await eventPreview(c, d.payload);
  if (
    d.kind === "daily" &&
    (
      await c.query("SELECT 1 FROM daily_user_attempts WHERE date=$1 LIMIT 1", [
        d.payload.date,
      ])
    ).rowCount
  )
    throw httpError(409, "Journée commencée : modification interdite.");
  return current;
}
async function apply(c, d) {
  const p = d.payload;
  await c.query(
    "SELECT set_config('camino.admin_actor',$1,true),set_config('camino.admin_reason',$2,true)",
    [d.actor_name || "Publication programmée", d.title],
  );
  if (d.kind === "daily")
    await c.query(
      `INSERT INTO daily_targets(date,street_name,arrondissement,coordinates_json,image_url) VALUES($1,$2,$3,$4,$5) ON CONFLICT(date) DO UPDATE SET street_name=EXCLUDED.street_name,arrondissement=EXCLUDED.arrondissement,coordinates_json=EXCLUDED.coordinates_json,image_url=EXCLUDED.image_url`,
      [
        p.date,
        p.street_name,
        p.quartier,
        JSON.stringify(p.coordinates),
        p.image_url,
      ],
    );
  if (d.kind === "daily")
    await c.query(
      `UPDATE cards SET image_override=$2,image_credit_override=NULL
      WHERE family='street' AND status='active' AND catalog_present
      AND (source_entity_id=$1 OR LOWER(name)=LOWER($1))`,
      [p.street_name, p.image_url],
    );
  if (d.kind === "card")
    await c.query(
      "UPDATE cards SET description_override=$2,description_full_override=$3,image_override=$4,image_credit_override=$5 WHERE id=$1",
      [
        d.entity_key,
        p.description_override,
        p.description_full_override,
        p.image_override,
        p.image_credit_override,
      ],
    );
  if (d.kind === "explorer") {
    const values = Object.values(p);
    if (d.entity_key === "new") {
      const row = (
        await c.query(
          "INSERT INTO explorer_riddles(way_id,street_name_clean,riddle_text,hint_text,explanation_text,image_url,latitude,longitude) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
          values,
        )
      ).rows[0];
      await c.query("UPDATE admin_drafts SET entity_key=$2 WHERE id=$1", [
        d.id,
        String(row.id),
      ]);
    } else
      await c.query(
        "UPDATE explorer_riddles SET way_id=$1,street_name_clean=$2,riddle_text=$3,hint_text=$4,explanation_text=$5,image_url=$6,latitude=$7,longitude=$8,revision=revision+1 WHERE id=$9",
        [...values, d.entity_key],
      );
  }
  if (d.kind === "event")
    await c.query(
      "INSERT INTO admin_events(week_start,title,objectives,actor_id) VALUES($1,$2,$3,$4) ON CONFLICT(week_start) DO UPDATE SET title=EXCLUDED.title,objectives=EXCLUDED.objectives,actor_id=EXCLUDED.actor_id,published_at=NOW()",
      [p.week_start, d.title, JSON.stringify(p.objectives), d.actor_id],
    );
}
async function publish(pool, id, revision, actor, invalidate) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(hashtext('admin-publishing'))");
    const d = (
      await c.query(
        "SELECT d.*,u.username AS actor_name FROM admin_drafts d LEFT JOIN users u ON u.id=d.actor_id WHERE d.id=$1 FOR UPDATE OF d",
        [id],
      )
    ).rows[0];
    if (!d) throw httpError(404, "Brouillon introuvable");
    if (
      d.revision !== revision ||
      !["draft", "scheduled", "failed"].includes(d.state)
    )
      throw httpError(409, "Le brouillon a changé.");
    await checkPublish(c, d);
    if (d.kind === "street") {
      await c.query(
        "SELECT revision FROM admin_content_state WHERE id=1 FOR UPDATE",
      );
      const before = await readSettings(c);
      const infos = JSON.parse(before.content_street_infos_v1 || "{}");
      const current = {
        value: infos[d.payload.mode]?.[d.payload.name] ?? null,
      };
      if (fingerprint(current) !== fingerprint(d.base_snapshot))
        throw httpError(409, "La fiche a changé.");
      infos[d.payload.mode] ??= {};
      infos[d.payload.mode][d.payload.name] = d.payload.description;
      await c.query(
        "INSERT INTO app_settings(key,value_text) VALUES('content_street_infos_v1',$1) ON CONFLICT(key) DO UPDATE SET value_text=EXCLUDED.value_text,updated_at=NOW()",
        [JSON.stringify(infos)],
      );
      const after = await readSettings(c);
      await c.query(
        "INSERT INTO admin_content_revisions(actor_username,action,before_settings,after_settings) VALUES($1,$2,$3,$4)",
        [
          actor,
          "Publication fiche " + d.payload.name,
          JSON.stringify(before),
          JSON.stringify(after),
        ],
      );
      await c.query(
        "UPDATE admin_content_state SET revision=revision+1 WHERE id=1",
      );
      await c.query(
        "INSERT INTO admin_entity_revisions(domain,entity_key,before_json,after_json,actor,reason) VALUES($1,$2,$3,$4,$5,$6)",
        [
          "street",
          d.entity_key,
          JSON.stringify({ ...d.payload, description: current.value }),
          JSON.stringify(d.payload),
          actor,
          d.title,
        ],
      );
    } else await apply(c, { ...d, actor_name: actor });
    await c.query(
      "UPDATE admin_drafts SET state='published',revision=revision+1,error=NULL,updated_at=NOW() WHERE id=$1",
      [id],
    );
    await c.query("COMMIT");
    invalidate();
    return { published: true };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
async function tick(pool, invalidate) {
  const due = (
    await pool.query(
      "SELECT id,revision,kind FROM admin_drafts WHERE state='scheduled' AND publish_at<=NOW() ORDER BY publish_at LIMIT 20",
    )
  ).rows;
  for (const d of due)
    try {
      const approver = (
        await pool.query(
          "SELECT u.id,u.username,u.role,u.suspended_at FROM admin_drafts d JOIN users u ON u.id=d.publisher_id WHERE d.id=$1",
          [d.id],
        )
      ).rows[0];
      if (
        !approver ||
        approver.suspended_at ||
        !(await require("./security").allowed(pool, approver, "publish")) ||
        (d.kind === "event" &&
          !(await require("./security").allowed(pool, approver, "events")))
      )
        throw httpError(
          403,
          "La permission de publication du responsable a changé.",
        );
      await publish(
        pool,
        d.id,
        d.revision,
        approver.username + " · programmation",
        invalidate,
      );
    } catch (e) {
      await pool.query(
        "UPDATE admin_drafts SET state='failed',error=$2,revision=revision+1 WHERE id=$1 AND revision=$3 AND state='scheduled'",
        [d.id, String(e.message).slice(0, 500), d.revision],
      );
    }
}
module.exports = {
  text,
  kinds,
  dateKey,
  image,
  validate,
  snapshot,
  fingerprint,
  eventPreview,
  publish,
  tick,
};
