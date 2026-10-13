const repository = require("./repository");
const service = require("./service");
const db = { pool: repository };
const {
  normalizeRiddlePayload,
  toPositiveInteger,
  toSafeInteger,
} = require("./validation");

async function listRiddles(req, res) {
  const result = await db.pool.query(
    `SELECT id, way_id, street_name_clean, riddle_text, hint_text, explanation_text, image_url,
            latitude, longitude, created_at, revision, source_url
     FROM explorer_riddles
     WHERE archived_at IS NULL
     ORDER BY id ASC`,
  );
  res.json({ riddles: result.rows });
}

async function listAdminRiddles(req, res) {
  const result = await db.pool.query(
    `SELECT r.*, (SELECT COUNT(*)::int FROM explorer_user_progress p WHERE p.riddle_id=r.id) AS player_count FROM explorer_riddles r ORDER BY r.archived_at NULLS FIRST,r.id`,
  );
  res.setHeader("Cache-Control", "no-store");
  return res.json({ riddles: result.rows });
}

async function createAdminRiddle(req, res) {
  const payload = normalizeRiddlePayload(req.body);
  if (!payload.ok) {
    return res.status(400).json({ error: payload.error });
  }

  const result = await db.pool.query(
    `INSERT INTO explorer_riddles (
       way_id, street_name_clean, riddle_text, hint_text, explanation_text, image_url, latitude, longitude
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    payload.values,
  );
  return res.status(201).json({ riddle: result.rows[0] });
}

async function updateAdminRiddle(req, res) {
  const riddleId = toPositiveInteger(req.params.id);
  if (!riddleId) {
    return res.status(400).json({ error: "Invalid riddle id" });
  }

  if (!Number.isSafeInteger(req.body?.expectedRevision))
    return res
      .status(428)
      .json({ error: "Actualisez l’énigme avant de l’enregistrer." });
  const payload = normalizeRiddlePayload(req.body);
  if (!payload.ok) {
    return res.status(400).json({ error: payload.error });
  }

  const result = await db.pool.query(
    `UPDATE explorer_riddles
     SET way_id = $1,
         street_name_clean = $2,
         riddle_text = $3,
         hint_text = $4,
         explanation_text = $5,
         image_url = $6,
         latitude = $7,
         longitude = $8, revision = revision + 1
     WHERE id = $9 AND revision = $10
     RETURNING *`,
    [...payload.values, riddleId, req.body?.expectedRevision],
  );
  if (!result.rowCount) {
    return res.status(409).json({
      error:
        "L’énigme a changé. Votre saisie est conservée ; copiez-la avant d’actualiser.",
    });
  }
  return res.json({ riddle: result.rows[0] });
}

async function deleteAdminRiddle(req, res) {
  const id = toPositiveInteger(req.params.id);
  if (!id || !Number.isSafeInteger(req.body?.expectedRevision))
    return res.status(400).json({ error: "Énigme ou révision invalide" });
  const result = await db.pool.query(
    "UPDATE explorer_riddles SET archived_at=NOW(),revision=revision+1 WHERE id=$1 AND revision=$2 AND archived_at IS NULL RETURNING id",
    [id, req.body?.expectedRevision],
  );
  if (!result.rowCount)
    return res
      .status(409)
      .json({ error: "L’énigme a changé ; actualisez avant de réessayer." });
  return res.json({ success: true });
}

async function restoreAdminRiddle(req, res) {
  const id = toPositiveInteger(req.params.id);
  if (!id || !Number.isSafeInteger(req.body?.expectedRevision))
    return res.status(400).json({ error: "Énigme ou révision invalide" });
  const result = await db.pool.query(
    "UPDATE explorer_riddles SET archived_at=NULL,revision=revision+1 WHERE id=$1 AND revision=$2 AND archived_at IS NOT NULL RETURNING id",
    [id, req.body?.expectedRevision],
  );
  if (!result.rowCount)
    return res
      .status(409)
      .json({ error: "L’énigme a changé ; actualisez avant de réessayer." });
  return res.json({ success: true });
}

async function searchStreets(req, res) {
  res.json({ streets: service.searchStreets(req.query.q) });
}

async function uploadAdminImage(req, res) {
  const imageUrl = await service.storeImage(req.body);
  if (!imageUrl) {
    return res.status(400).json({ error: "Invalid image data URL" });
  }
  return res.status(201).json({ image_url: imageUrl });
}

async function startStep(req, res) {
  const id = toPositiveInteger(req.params.id);
  if (!id) return res.status(400).json({ error: "Énigme invalide" });
  const existing = await db.pool.query(
    "SELECT started_at,hint_used FROM explorer_step_sessions WHERE user_id=$1 AND riddle_id=$2",
    [req.user.id, id],
  );
  if (existing.rows.length) return res.json(existing.rows[0]);
  const result = await db.pool.query(
    "INSERT INTO explorer_step_sessions(user_id,riddle_id,riddle_snapshot) SELECT $1,id,to_jsonb(explorer_riddles) FROM explorer_riddles WHERE id=$2 AND archived_at IS NULL ON CONFLICT(user_id,riddle_id) DO UPDATE SET riddle_id=EXCLUDED.riddle_id RETURNING started_at,hint_used",
    [req.user.id, id],
  );
  if (!result.rows.length)
    return res.status(404).json({ error: "Énigme introuvable" });
  return res.json(result.rows[0]);
}
async function useHint(req, res) {
  const result = await db.pool.query(
    "UPDATE explorer_step_sessions SET hint_used=TRUE WHERE user_id=$1 AND riddle_id=$2 RETURNING hint_used",
    [req.user.id, toPositiveInteger(req.params.id)],
  );
  return result.rows.length
    ? res.json(result.rows[0])
    : res.status(409).json({ error: "Étape non démarrée" });
}
async function syncProgress(req, res) {
  const items = Array.isArray(req.body?.items) ? req.body.items : [req.body];
  if (!items.length || items.length > 50)
    return res.status(400).json({ error: "Maximum 50 étapes par envoi" });
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
      req.user.id,
    ]);
    const saved = [];
    for (const item of items) {
      const id = toPositiveInteger(item.riddle_id);
      if (!id)
        throw Object.assign(new Error("Énigme invalide"), { status: 400 });
      const existing = await client.query(
        "SELECT id,riddle_id,points_earned,walking_time_seconds,hints_used FROM explorer_user_progress WHERE user_id=$1 AND riddle_id=$2",
        [req.user.id, id],
      );
      if (existing.rows.length) {
        saved.push(existing.rows[0]);
        continue;
      }
      const riddle = (
        await client.query("SELECT * FROM explorer_riddles WHERE id=$1", [id])
      ).rows[0];
      const step = (
        await client.query(
          "SELECT * FROM explorer_step_sessions WHERE user_id=$1 AND riddle_id=$2 FOR UPDATE",
          [req.user.id, id],
        )
      ).rows[0];
      if (!riddle)
        throw Object.assign(new Error("Énigme introuvable"), { status: 404 });
      const verified = require("../game-integrity/explorer").stepResult(
        item,
        step?.riddle_snapshot || riddle,
        step,
      );
      const result = await client.query(
        `INSERT INTO explorer_user_progress(user_id,riddle_id,started_at,solved_at,hints_used,points_earned,walking_time_seconds,client_payload)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING id,riddle_id,points_earned,walking_time_seconds,hints_used`,
        [
          req.user.id,
          id,
          verified.startedAt,
          verified.solvedAt,
          verified.hintsUsed,
          verified.pointsEarned,
          verified.walkingTimeSeconds,
          JSON.stringify({
            ocr_text: String(item.ocr_text).slice(0, 2000),
            client_validated: false,
            server_verified: true,
          }),
        ],
      );
      saved.push(result.rows[0]);
    }
    const leaderboard = (
      await client.query(
        `INSERT INTO explorer_leaderboard(user_id,total_score,total_walking_time_seconds)
 SELECT $1,COALESCE(SUM(points_earned),0)::int,COALESCE(SUM(walking_time_seconds),0)::int FROM explorer_user_progress WHERE user_id=$1
 ON CONFLICT(user_id) DO UPDATE SET total_score=EXCLUDED.total_score,total_walking_time_seconds=EXCLUDED.total_walking_time_seconds RETURNING *`,
        [req.user.id],
      )
    ).rows[0];
    await client.query("COMMIT");
    return res.json({ success: true, saved, leaderboard });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
async function submitFinalScore(req, res) {
  const total = (
    await db.pool.query(
      `SELECT COUNT(*) FILTER(WHERE r.archived_at IS NULL)::int AS solved,COALESCE(SUM(p.points_earned),0)::int AS score,COALESCE(SUM(p.walking_time_seconds),0)::int AS seconds FROM explorer_user_progress p JOIN explorer_riddles r ON r.id=p.riddle_id WHERE p.user_id=$1`,
      [req.user.id],
    )
  ).rows[0];
  const count = Number(
    (
      await db.pool.query(
        "SELECT COUNT(*) AS count FROM explorer_riddles WHERE archived_at IS NULL",
      )
    ).rows[0].count,
  );
  if (!count || total.solved < count)
    return res.status(409).json({
      error: "Terminez toutes les énigmes avant de confirmer le parcours",
    });
  const result = await db.pool.query(
    `INSERT INTO explorer_leaderboard(user_id,total_score,total_walking_time_seconds,completed_at) VALUES($1,$2,$3,NOW())
 ON CONFLICT(user_id) DO UPDATE SET total_score=EXCLUDED.total_score,total_walking_time_seconds=EXCLUDED.total_walking_time_seconds,completed_at=COALESCE(explorer_leaderboard.completed_at,EXCLUDED.completed_at) RETURNING *`,
    [req.user.id, total.score, total.seconds],
  );
  return res.json({ success: true, leaderboard: result.rows[0] });
}

async function getLeaderboard(req, res) {
  const limit = Math.min(100, Math.max(1, toSafeInteger(req.query.limit, 25)));
  const result = await db.pool.query(
    `SELECT
       l.user_id,
       u.username,
       u.avatar,
       l.total_score,
       l.total_walking_time_seconds,
       l.completed_at
     FROM explorer_leaderboard l
     JOIN users u ON u.id = l.user_id
     ORDER BY l.total_score DESC, l.total_walking_time_seconds ASC, l.completed_at ASC NULLS LAST
     LIMIT $1`,
    [limit],
  );
  res.json({ leaderboard: result.rows });
}

async function getUserExplorerProfile(userId) {
  const normalizedUserId = toPositiveInteger(userId);
  if (!normalizedUserId) {
    return { completed: false, solved_count: 0 };
  }

  const result = await db.pool.query(
    `SELECT
       COUNT(p.id)::int AS solved_count,
       COALESCE(SUM(p.points_earned), 0)::int AS synced_score,
       COALESCE(SUM(p.walking_time_seconds), 0)::int AS synced_walking_time_seconds,
       l.total_score,
       l.total_walking_time_seconds,
       l.completed_at
     FROM users u
     LEFT JOIN explorer_user_progress p ON p.user_id = u.id
     LEFT JOIN explorer_leaderboard l ON l.user_id = u.id
     WHERE u.id = $1
     GROUP BY l.total_score, l.total_walking_time_seconds, l.completed_at`,
    [normalizedUserId],
  );

  const row = result.rows[0] || {};
  return {
    completed: Boolean(row.completed_at),
    solved_count: toSafeInteger(row.solved_count),
    synced_score: toSafeInteger(row.synced_score),
    synced_walking_time_seconds: toSafeInteger(row.synced_walking_time_seconds),
    total_score:
      row.total_score === null || row.total_score === undefined
        ? null
        : toSafeInteger(row.total_score),
    total_walking_time_seconds:
      row.total_walking_time_seconds === null ||
      row.total_walking_time_seconds === undefined
        ? null
        : toSafeInteger(row.total_walking_time_seconds),
    completed_at: row.completed_at || null,
    badge_id: row.completed_at ? "explorateur_paris" : null,
    theme_unlocked: Boolean(row.completed_at),
  };
}

async function getProgress(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  const progress = (
    await db.pool.query(
      "SELECT riddle_id,started_at,solved_at,hints_used,points_earned,walking_time_seconds FROM explorer_user_progress WHERE user_id=$1",
      [req.user.id],
    )
  ).rows;
  return res.json({
    progress,
    profile: await getUserExplorerProfile(req.user.id),
  });
}
async function simulateStep(req, res) {
  const normalized = normalizeRiddlePayload(req.body?.riddle);
  if (!normalized.ok) return res.status(400).json({ error: normalized.error });
  const [way_id, street_name_clean, , , , , latitude, longitude] =
    normalized.values;
  const riddle = { way_id, street_name_clean, latitude, longitude };
  const integrity = require("../game-integrity/explorer");
  const item = req.body?.answer || {};
  const point = [Number(item.longitude), Number(item.latitude)];
  if (
    item.latitude == null ||
    item.longitude == null ||
    !point.every(Number.isFinite) ||
    Math.abs(point[0]) > 180 ||
    Math.abs(point[1]) > 90
  )
    return res.status(400).json({ error: "Position de simulation invalide" });
  const distanceMeters = integrity.distanceToRiddle(point, riddle);
  const plaqueMatches = integrity.plaqueMatches(
    String(item.ocr_text || "").slice(0, 2000),
    street_name_clean,
  );
  return res.json({
    simulation: true,
    distanceMeters: Number.isFinite(distanceMeters)
      ? Math.round(distanceMeters)
      : null,
    plaqueMatches,
    valid: plaqueMatches && distanceMeters <= 100,
  });
}

module.exports = {
  getProgress,
  simulateStep,
  listRiddles,
  listAdminRiddles,
  createAdminRiddle,
  updateAdminRiddle,
  deleteAdminRiddle,
  restoreAdminRiddle,
  searchStreets,
  uploadAdminImage,
  syncProgress,
  startStep,
  useHint,
  submitFinalScore,
  getLeaderboard,
  getUserExplorerProfile,
};
