"use strict";
const { httpError } = require("./content");
const { text, fingerprint } = require("./editorial");
async function audience(c, kind) {
  if (!["all", "active30", "inactive30"].includes(kind))
    throw httpError(400, "Audience invalide.");
  return (
    await c.query(
      `WITH activity AS (SELECT user_id,timestamp AS at FROM scores UNION ALL SELECT user_id,last_attempt_at FROM daily_user_attempts UNION ALL SELECT user_id,started_at FROM collect_games UNION ALL SELECT user_id,started_at FROM explorer_step_sessions)
 SELECT u.id FROM users u WHERE u.suspended_at IS NULL AND u.admin_announcements AND NOT EXISTS(SELECT 1 FROM admin_campaign_deliveries d WHERE d.user_id=u.id AND NOT d.test AND d.delivered_at>NOW()-INTERVAL '7 days')
 AND ($1='all' OR ($1='active30')=EXISTS(SELECT 1 FROM activity a WHERE a.user_id=u.id AND a.at>NOW()-INTERVAL '30 days')) ORDER BY u.id`,
      [kind],
    )
  ).rows.map((r) => r.id);
}
function validate(p) {
  if (
    !text(p.title, 120) ||
    !text(p.body, 1000) ||
    !/^\/(?!\/)[\w/?=&.#%-]*$/.test(p.url || "")
  )
    throw httpError(400, "Titre, message et lien interne requis.");
  return {
    title: text(p.title, 120),
    body: text(p.body, 1000),
    url: p.url,
    audience: p.audience,
  };
}
async function preview(c, row, selectedIds) {
  const ids = selectedIds || (await audience(c, row.audience));
  return {
    count: ids.length,
    fingerprint: fingerprint({ id: row.id, revision: row.revision, ids }),
    title: row.title,
    body: row.body,
    url: row.url,
    note: "Notification dans le centre du site, selon les préférences. Maximum une campagne par joueur sur 7 jours ; aucun push ni courriel.",
  };
}
async function send(pool, id, actor, p, test = false) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(hashtext('admin-campaigns'))");
    const row = (
      await c.query("SELECT * FROM admin_campaigns WHERE id=$1 FOR UPDATE", [
        id,
      ])
    ).rows[0];
    if (!row || row.state !== "draft")
      throw httpError(409, "Campagne déjà envoyée ou indisponible.");
    const recipients = await audience(c, row.audience);
    const v = await preview(c, row, recipients);
    if (!test && v.fingerprint !== p.fingerprint)
      throw httpError(409, "Audience modifiée : refaites l’aperçu.");
    const ids = test ? [actor] : recipients;
    await c.query(
      "INSERT INTO admin_campaign_deliveries(campaign_id,user_id,test) SELECT $1,unnest($2::integer[]),$3 ON CONFLICT DO NOTHING",
      [id, ids, test],
    );
    if (!test)
      await c.query(
        "UPDATE admin_campaigns SET state='sent',sent_at=NOW(),revision=revision+1 WHERE id=$1",
        [id],
      );
    await c.query("COMMIT");
    return { delivered: ids.length, test };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
module.exports = { audience, validate, preview, send };
