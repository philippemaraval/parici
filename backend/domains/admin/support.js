"use strict";
const { httpError } = require("./content");
const { fingerprint, text } = require("./editorial");
async function preview(c, id, p, lock = false) {
  const user = (
    await c.query(
      "SELECT id,username,role,session_version,suspended_at FROM users WHERE id=$1",
      [id],
    )
  ).rows[0];
  if (!user) throw httpError(404, "Joueur introuvable.");
  const actions = [
    "revoke",
    "suspend",
    "resume",
    "grant-card",
    "correct-explorer",
  ];
  if (!actions.includes(p.action)) throw httpError(400, "Action inconnue.");
  if (user.role !== "player" && ["suspend", "resume"].includes(p.action))
    throw httpError(403, "La suspension est réservée aux comptes joueurs.");
  const before = { user },
    effects = { action: p.action };
  if (p.action === "grant-card") {
    if (!Number.isSafeInteger(p.cardId) || p.cardId < 1)
      throw httpError(400, "Carte invalide.");
    const card = (
      await c.query(
        "SELECT id,name,status,catalog_present FROM cards WHERE id=$1" +
          (lock ? " FOR SHARE" : ""),
        [p.cardId],
      )
    ).rows[0];
    if (!card || card.status !== "active" || !card.catalog_present)
      throw httpError(400, "Carte active requise.");
    before.card = card;
    effects.card = card.name;
    effects.copies = 1;
  }
  if (p.action === "correct-explorer") {
    if (!Number.isSafeInteger(p.riddleId) || p.riddleId < 1)
      throw httpError(400, "Étape invalide.");
    if (!Number.isInteger(p.points) || p.points < 0 || p.points > 70)
      throw httpError(400, "Points attendus entre 0 et 70.");
    const progress = (
      await c.query(
        "SELECT * FROM explorer_user_progress WHERE user_id=$1 AND riddle_id=$2" +
          (lock ? " FOR UPDATE" : ""),
        [id, p.riddleId],
      )
    ).rows[0];
    if (!progress) throw httpError(404, "Étape déjà résolue requise.");
    before.progress = progress;
    effects.previousPoints = progress.points_earned;
    effects.points = p.points;
  }
  return {
    before,
    effects,
    fingerprint: fingerprint({
      before,
      action: p.action,
      cardId: p.cardId ?? null,
      riddleId: p.riddleId ?? null,
      points: p.points ?? null,
    }),
  };
}
async function execute(pool, id, actor, p) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      p.requestId || "",
    ) ||
    text(p.reason).length < 10
  )
    throw httpError(
      400,
      "Motif explicite (10 caractères minimum) et identifiant requis.",
    );
  const requestHash = fingerprint({
    userId: String(id),
    action: p.action,
    cardId: p.cardId ?? null,
    riddleId: p.riddleId ?? null,
    points: p.points ?? null,
    reason: text(p.reason),
    fingerprint: p.fingerprint,
  });
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [id]);
    const existing = (
      await c.query("SELECT * FROM admin_interventions WHERE id=$1", [
        p.requestId,
      ])
    ).rows[0];
    if (existing) {
      if (
        Number(existing.user_id) !== Number(id) ||
        Number(existing.actor_id) !== Number(actor) ||
        existing.request_hash !== requestHash
      )
        throw httpError(409, "Identifiant déjà utilisé.");
      await c.query("COMMIT");
      return { intervention: existing, replayed: true };
    }
    const v = await preview(c, id, p, true);
    if (v.fingerprint !== p.fingerprint)
      throw httpError(
        409,
        "Le compte ou la progression a changé : recommencez l’aperçu.",
      );
    if (p.action === "revoke")
      await c.query(
        "UPDATE users SET session_version=session_version+1 WHERE id=$1",
        [id],
      );
    if (p.action === "suspend")
      await c.query(
        "UPDATE users SET suspended_at=NOW(),session_version=session_version+1 WHERE id=$1",
        [id],
      );
    if (p.action === "resume")
      await c.query("UPDATE users SET suspended_at=NULL WHERE id=$1", [id]);
    if (p.action === "grant-card") {
      const copy = (
        await c.query(
          "INSERT INTO card_copies(user_id,card_id,source) VALUES($1,$2,'admin') RETURNING id",
          [id, p.cardId],
        )
      ).rows[0];
      v.effects.copyId = copy.id;
    }
    if (p.action === "correct-explorer") {
      await c.query(
        "UPDATE explorer_user_progress SET points_earned=$3 WHERE user_id=$1 AND riddle_id=$2",
        [id, p.riddleId, p.points],
      );
      await c.query(
        "UPDATE explorer_leaderboard SET total_score=(SELECT COALESCE(SUM(points_earned),0) FROM explorer_user_progress WHERE user_id=$1) WHERE user_id=$1",
        [id],
      );
    }
    const row = (
      await c.query(
        "INSERT INTO admin_interventions(id,user_id,actor_id,action,reason,before_json,after_json,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
        [
          p.requestId,
          id,
          actor,
          p.action,
          text(p.reason),
          JSON.stringify(v.before),
          JSON.stringify(v.effects),
          requestHash,
        ],
      )
    ).rows[0];
    await c.query("COMMIT");
    return { intervention: row };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
module.exports = { preview, execute };
