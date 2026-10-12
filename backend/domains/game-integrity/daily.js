"use strict";
const normalize = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’]/g, "'")
    .trim()
    .toLowerCase();
let cachedFeatures;
function getStreetFeatures() {
  if (!cachedFeatures)
    cachedFeatures = JSON.parse(
      require("node:fs").readFileSync(
        require("node:path").resolve(
          __dirname,
          "../../data/paris_rues_light.geojson",
        ),
        "utf8",
      ),
    ).features;
  return cachedFeatures;
}
function midpoint(features) {
  const points = [];
  function collect(value) {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number") points.push(value);
    else value.forEach(collect);
  }
  features.forEach((f) => collect(f.geometry?.coordinates));
  if (!points.length) return null;
  return [0, 1].map(
    (axis) =>
      (Math.min(...points.map((p) => p[axis])) +
        Math.max(...points.map((p) => p[axis]))) /
      2,
  );
}
function distance(a, b) {
  const rad = Math.PI / 180,
    dLat = (b[1] - a[1]) * rad,
    dLng = (b[0] - a[0]) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(
    6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h))),
  );
}
function evaluateGuess(target, answerName, features) {
  const selected = features.filter(
    (f) => normalize(f.properties?.name) === normalize(answerName),
  );
  if (!selected.length)
    throw Object.assign(new Error("Lieu sélectionné introuvable"), {
      status: 400,
    });
  const success = normalize(answerName) === normalize(target.street_name);
  const targetFeatures = features.filter(
    (f) => normalize(f.properties?.name) === normalize(target.street_name),
  );
  const from = midpoint(selected),
    to = midpoint(targetFeatures) || target.coordinates_json;
  if (!from || !Array.isArray(to))
    throw Object.assign(new Error("Localisation indisponible"), {
      status: 400,
    });
  return { success, distanceMeters: success ? 0 : distance(from, to) };
}
async function submitGuess(db, userId, payload, target, features) {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
    const receipt = await client.query(
      "SELECT result_json FROM daily_guess_receipts WHERE user_id=$1 AND date=$2 AND request_id=$3",
      [userId, payload.date, payload.requestId],
    );
    if (receipt.rows[0]) {
      await client.query("COMMIT");
      return receipt.rows[0].result_json;
    }
    const current = await client.query(
      "SELECT success,attempts_count FROM daily_user_attempts WHERE user_id=$1 AND date=$2",
      [userId, payload.date],
    );
    if (
      current.rows[0]?.success ||
      Number(current.rows[0]?.attempts_count) >= 7
    )
      throw Object.assign(new Error("Ce Daily est terminé"), { status: 409 });
    const evaluation = evaluateGuess(target, payload.answerName, features);
    const result = await db.updateDailyUserAttempt(
      userId,
      payload.date,
      evaluation.distanceMeters,
      evaluation.success,
      null,
      client,
    );
    await client.query(
      "INSERT INTO daily_guess_receipts(user_id,date,request_id,result_json) VALUES($1,$2,$3,$4::jsonb)",
      [userId, payload.date, payload.requestId, JSON.stringify(result)],
    );
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
module.exports = {
  evaluateGuess,
  submitGuess,
  midpoint,
  normalize,
  distance,
  getStreetFeatures,
};
