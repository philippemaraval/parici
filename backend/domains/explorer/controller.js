const repository = require("./repository");
const service = require("./service");
const db = { pool: repository };
const {
  normalizeRiddlePayload,
  toPositiveInteger,
  toSafeInteger,
} = require("./validation");

function solution(riddle) {
  return {
    street_name_clean: riddle.street_name_clean,
    explanation_text: riddle.explanation_text,
    source_url: riddle.source_url,
  };
}
async function listRiddles(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const result = await db.pool.query(
    `SELECT id,riddle_text,image_url,revision FROM explorer_riddles WHERE archived_at IS NULL ORDER BY id ASC`,
  );
  res.json({
    riddles: result.rows.map((r) => ({
      ...r,
      image_url: `/api/explorer/riddles/${r.id}/image`,
    })),
  });
}
async function nextRiddle(req, res) {
  const body = req.body || {},
    point = [Number(body.longitude), Number(body.latitude)];
  if (
    body.latitude == null ||
    body.longitude == null ||
    !point.every(Number.isFinite) ||
    Math.abs(point[0]) > 180 ||
    Math.abs(point[1]) > 90
  )
    return res.status(400).json({ error: "Position requise" });
  const rows = (
    await db.pool.query(
      `SELECT r.* FROM explorer_riddles r WHERE r.archived_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM explorer_user_progress p WHERE p.user_id=$1 AND p.riddle_id=r.id)`,
      [req.user.id],
    )
  ).rows;
  const integrity = require("../game-integrity/explorer");
  const ranked = rows
    .map((riddle) => ({
      riddle,
      distance: integrity.distanceToRiddle(point, riddle),
    }))
    .sort((a, b) => a.distance - b.distance);
  const solved = Number(
    (
      await db.pool.query(
        "SELECT COUNT(*)::int AS count FROM explorer_user_progress WHERE user_id=$1",
        [req.user.id],
      )
    ).rows[0].count,
  );
  const pool = ranked.slice(0, solved ? Math.min(5, ranked.length) : 1);
  res.setHeader("Cache-Control", "private, no-store");
  res.json({
    riddleId: pool.length
      ? pool[require("node:crypto").randomInt(pool.length)].riddle.id
      : null,
  });
}

async function riddleImage(req, res) {
  const id = toPositiveInteger(req.params.id);
  if (!id) return res.sendStatus(404);
  const row = (
    await db.pool.query("SELECT image_url FROM explorer_riddles WHERE id=$1", [
      id,
    ])
  ).rows[0];
  if (!row) return res.sendStatus(404);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (row.image_url.startsWith("/data/explorer_uploads/")) {
    const name = require("node:path").basename(row.image_url);
    const image = (
      await db.pool.query(
        "SELECT mime_type,content FROM explorer_uploaded_images WHERE filename=$1",
        [name],
      )
    ).rows[0];
    return image
      ? res.type(image.mime_type).send(image.content)
      : res.sendStatus(404);
  }
  if (/^https?:/.test(row.image_url)) {
    // Editorial external URLs are proxied only through an allowlist of public image hosts.
    const url = new URL(row.image_url);
    if (
      url.protocol !== "https:" ||
      !["upload.wikimedia.org", "images.paris.fr"].includes(url.hostname) ||
      url.username ||
      url.password
    )
      return res.sendStatus(422);
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (
      !response.ok ||
      !/^image\/(jpeg|png|webp)/.test(
        response.headers.get("content-type") || "",
      )
    )
      return res.sendStatus(502);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 5 * 1024 * 1024) return res.sendStatus(413);
    return res.type(response.headers.get("content-type")).send(bytes);
  }
  const path = require("node:path"),
    root = path.resolve(__dirname, "../../.."),
    file = path.resolve(root, "." + row.image_url);
  if (
    !file.startsWith(path.join(root, "data") + path.sep) ||
    !/[.]?(?:jpg|jpeg|png|webp)$/i.test(file)
  )
    return res.sendStatus(404);
  return res.sendFile(file);
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
    "SELECT started_at,hint_used,riddle_snapshot FROM explorer_step_sessions WHERE user_id=$1 AND riddle_id=$2",
    [req.user.id, id],
  );
  if (existing.rows.length) {
    const step = existing.rows[0];
    return res.json({
      started_at: step.started_at,
      hint_used: step.hint_used,
      riddle: {
        id,
        riddle_text: step.riddle_snapshot?.riddle_text,
        image_url: `/api/explorer/riddles/${id}/image`,
      },
      ...(step.hint_used ? { hint_text: step.riddle_snapshot?.hint_text } : {}),
    });
  }
  const result = await db.pool.query(
    "INSERT INTO explorer_step_sessions(user_id,riddle_id,riddle_snapshot) SELECT $1,id,to_jsonb(explorer_riddles) FROM explorer_riddles WHERE id=$2 AND archived_at IS NULL ON CONFLICT(user_id,riddle_id) DO UPDATE SET riddle_id=EXCLUDED.riddle_id RETURNING started_at,hint_used,riddle_snapshot",
    [req.user.id, id],
  );
  if (!result.rows.length)
    return res.status(404).json({ error: "Énigme introuvable" });
  const step = result.rows[0];
  return res.json({
    started_at: step.started_at,
    hint_used: step.hint_used,
    riddle: {
      id,
      riddle_text: step.riddle_snapshot?.riddle_text,
      image_url: `/api/explorer/riddles/${id}/image`,
    },
  });
}
async function useHint(req, res) {
  const result = await db.pool.query(
    "UPDATE explorer_step_sessions SET hint_used=TRUE WHERE user_id=$1 AND riddle_id=$2 RETURNING hint_used,riddle_snapshot->>'hint_text' AS hint_text",
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
    const discovered = (
      await client.query(
        `SELECT p.riddle_id,COALESCE(s.riddle_snapshot,to_jsonb(r)) AS snapshot
      FROM explorer_user_progress p JOIN explorer_riddles r ON r.id=p.riddle_id
      LEFT JOIN explorer_step_sessions s ON s.user_id=p.user_id AND s.riddle_id=p.riddle_id
      WHERE p.user_id=$1 AND p.riddle_id=ANY($2::bigint[])`,
        [req.user.id, saved.map((row) => row.riddle_id)],
      )
    ).rows;
    for (const row of saved)
      row.solution = solution(
        discovered.find((r) => Number(r.riddle_id) === Number(row.riddle_id))
          .snapshot,
      );
    await client.query("COMMIT");
    res.setHeader("Cache-Control", "private, no-store");
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
      `SELECT p.riddle_id,p.started_at,p.solved_at,p.hints_used,p.points_earned,p.walking_time_seconds,
      jsonb_build_object('street_name_clean',COALESCE(s.riddle_snapshot->>'street_name_clean',r.street_name_clean),
      'explanation_text',COALESCE(s.riddle_snapshot->>'explanation_text',r.explanation_text),
      'source_url',COALESCE(s.riddle_snapshot->>'source_url',r.source_url)) AS solution
      FROM explorer_user_progress p JOIN explorer_riddles r ON r.id=p.riddle_id
      LEFT JOIN explorer_step_sessions s ON s.user_id=p.user_id AND s.riddle_id=p.riddle_id WHERE p.user_id=$1`,
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
  nextRiddle,
  riddleImage,
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
