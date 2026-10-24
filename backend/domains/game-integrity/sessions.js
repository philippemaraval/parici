"use strict";
const crypto = require("node:crypto"),
  fs = require("node:fs"),
  path = require("node:path");
const { normalize } = require("./daily");
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const modes = new Set([
  "ville",
  "arrondissement",
  "arrondissements-ville",
  "rues-principales",
  "rues-celebres",
  "monuments",
  "stations-metro",
  "lignes-transports-idf",
]);
const types = new Set(["classique", "marathon", "chrono"]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function validateSelection(session, body, now = Date.now()) {
  const answers = session.answers || [],
    previous = answers.find((a) => a.requestId === body.requestId);
  if (previous) return { replay: previous };
  if (session.finished_at || session.paused_at)
    throw fail("Session terminée ou en pause", 409);
  if (!Number.isInteger(body.index) || body.index !== answers.length)
    throw fail("Réponse hors séquence", 409);
  if (
    session.game_type !== "chrono" &&
    answers.length >= session.targets.length
  )
    throw fail("Session terminée", 409);
  const elapsed = Math.max(
    0,
    (now -
      new Date(session.target_started_at).getTime() -
      Number(session.target_paused_ms)) /
      1000,
  );
  const totalTime = Math.max(
    0,
    (now - new Date(session.started_at).getTime() - Number(session.paused_ms)) /
      1000,
  );
  if (totalTime > 86400 || (session.game_type === "chrono" && totalTime > 65))
    throw fail("Session expirée", 410);
  if (
    session.game_type === "marathon" &&
    answers.filter((a) => !a.correct).length >= 3
  )
    throw fail("Session terminée", 409);
  const target = session.targets[answers.length % session.targets.length];
  const correct =
    Boolean(body.answerName) &&
    normalize(body.answerName) === normalize(target);
  return {
    requestId: body.requestId,
    correct,
    target,
    timeSec: elapsed,
    points: correct ? Math.max(0, 10 - Math.floor(elapsed / 2)) : 0,
  };
}
function scoreSession(session, now = Date.now()) {
  const answers = session.answers || [];
  if (
    session.game_type === "classique" &&
    answers.length < session.targets.length
  )
    throw fail("Session incomplète", 409);
  if (!answers.length) throw fail("Aucune réponse enregistrée", 409);
  const correct = answers.filter((a) => a.correct).length;
  return {
    mode: session.mode,
    gameType: session.game_type,
    score:
      session.game_type === "classique"
        ? answers.reduce((sum, a) => sum + a.points, 0)
        : correct,
    itemsCorrect: correct,
    itemsTotal: session.targets.length,
    timeSec: Math.max(
      0,
      (now -
        new Date(session.started_at).getTime() -
        Number(session.paused_ms) -
        (session.paused_at ? now - new Date(session.paused_at).getTime() : 0)) /
        1000,
    ),
    arrondissementName: session.arrondissement_name,
    sessionId: session.id,
    challengeId: session.challenge_id,
  };
}
function catalogNames(mode) {
  const root = path.resolve(__dirname, "../../..");
  const file =
    mode === "stations-metro"
      ? "data/paris_metro_stations.geojson"
      : mode === "monuments"
        ? "backend/data/paris_monuments.geojson"
        : mode === "arrondissements-ville"
          ? "data/paris_quartiers.geojson"
          : mode === "lignes-transports-idf"
            ? "data/paris_transit_lines.geojson"
            : "backend/data/paris_rues_light.geojson";
  return new Set(
    JSON.parse(fs.readFileSync(path.join(root, file), "utf8")).features.map(
      (f) =>
        normalize(
          f.properties.name || f.properties.l_qu || f.properties.nom_qua,
        ),
    ),
  );
}
async function start(db, userId, body, authorityTargets = null) {
  const mode =
    body.mode === "main"
      ? "rues-principales"
      : body.mode === "famous"
        ? "rues-celebres"
        : body.mode;
  if (
    !modes.has(mode) ||
    !types.has(body.gameType) ||
    !Array.isArray(body.availableNames) ||
    !body.availableNames.length ||
    body.availableNames.length > 20000
  )
    throw fail("Configuration invalide");
  const names = [...new Set(body.availableNames.map((v) => String(v).trim()))];
  const available = new Set(names.map(normalize));
  const known = authorityTargets ? null : catalogNames(mode);
  if (
    names.some(
      (n) => !n || n.length > 255 || (known && !known.has(normalize(n))),
    )
  )
    throw fail("Catalogue de session invalide");
  let challenge = null,
    targets;
  if (body.challengeCode) {
    challenge = await db.getFriendChallengeByCode(body.challengeCode);
    if (
      !challenge ||
      challenge.mode !== mode ||
      challenge.game_type !== body.gameType
    )
      throw fail("Défi incompatible");
    targets = challenge.targets_json.map((value) =>
      typeof value === "string" ? value : value.name,
    );
    if (targets.some((n) => !available.has(normalize(n))))
      throw fail("Lieux du défi indisponibles");
  } else if (authorityTargets) {
    targets = authorityTargets;
    if (targets.some((n) => !available.has(normalize(n))))
      throw fail("Rechargez le référentiel avant de démarrer", 409);
  } else {
    for (let i = names.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [names[i], names[j]] = [names[j], names[i]];
    }
    targets = body.gameType === "classique" ? names.slice(0, 20) : names;
  }
  if (!Array.isArray(targets) || !targets.length)
    throw fail("Aucun lieu disponible");
  const id = crypto.randomUUID();
  await db.pool.query(
    "INSERT INTO verified_game_sessions(id,user_id,mode,game_type,arrondissement_name,challenge_id,targets) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)",
    [
      id,
      userId,
      mode,
      body.gameType,
      challenge
        ? challenge.arrondissement_name
        : body.arrondissementName || null,
      challenge?.id || null,
      JSON.stringify(targets),
    ],
  );
  return { sessionId: id, targets };
}
async function withSession(db, userId, id, operation) {
  if (!UUID_PATTERN.test(String(id))) throw fail("Session invalide");
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const row = (
      await client.query(
        "SELECT * FROM verified_game_sessions WHERE id=$1 AND user_id=$2 FOR UPDATE",
        [id, userId],
      )
    ).rows[0];
    if (!row) throw fail("Session introuvable", 404);
    const result = await operation(client, row);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
async function answer(db, userId, id, body = {}) {
  if (
    !body ||
    !UUID_PATTERN.test(String(body.requestId)) ||
    typeof body.answerName !== "string" ||
    body.answerName.length > 255
  )
    throw fail("Réponse invalide");
  return withSession(db, userId, id, async (client, row) => {
    const result = validateSelection(row, body);
    if (result.replay) return result.replay;
    await client.query(
      "UPDATE verified_game_sessions SET answers=answers||$2::jsonb,target_started_at=NOW(),target_paused_ms=0 WHERE id=$1",
      [id, JSON.stringify([result])],
    );
    return result;
  });
}
async function pause(db, userId, id, paused) {
  if (typeof paused !== "boolean") throw fail("Pause invalide");
  return withSession(db, userId, id, async (client, row) => {
    if (row.finished_at) throw fail("Session terminée", 409);
    if (paused && !row.paused_at)
      await client.query(
        "UPDATE verified_game_sessions SET paused_at=NOW() WHERE id=$1",
        [id],
      );
    if (!paused && row.paused_at)
      await client.query(
        "UPDATE verified_game_sessions SET paused_ms=paused_ms+GREATEST(0,EXTRACT(EPOCH FROM(NOW()-paused_at))*1000)::bigint,target_paused_ms=target_paused_ms+GREATEST(0,EXTRACT(EPOCH FROM(NOW()-paused_at))*1000)::bigint,paused_at=NULL WHERE id=$1",
        [id],
      );
    return { paused };
  });
}
async function finish(db, userId, id, challengeId = undefined) {
  return withSession(db, userId, id, async (client, row) => {
    if (
      challengeId !== undefined &&
      Number(row.challenge_id || 0) !== Number(challengeId || 0)
    )
      throw fail("Session incompatible", 403);
    if (row.result_json) return row.result_json;
    const result = scoreSession(row);
    await client.query(
      "UPDATE verified_game_sessions SET finished_at=NOW(),result_json=$2::jsonb WHERE id=$1",
      [id, JSON.stringify(result)],
    );
    return result;
  });
}
module.exports = {
  start,
  answer,
  pause,
  finish,
  validateSelection,
  scoreSession,
};
