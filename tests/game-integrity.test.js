const test = require("node:test"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const { evaluateGuess } = require("../backend/domains/game-integrity/daily");
const {
  validateSelection,
  scoreSession,
} = require("../backend/domains/game-integrity/sessions");
const f = (name, x) => ({
  properties: { name },
  geometry: {
    type: "LineString",
    coordinates: [
      [x, 43.3],
      [x + 0.001, 43.3],
    ],
  },
});
test("Daily compares the selected place and computes its distance, independent of claimed results", () => {
  const target = { street_name: "Rue Sainte", coordinates_json: [5.37, 43.3] },
    features = [f("Rue Sainte", 5.37), f("Rue Paradis", 5.4)];
  assert.equal(evaluateGuess(target, "Rue Sainte", features).success, true);
  const wrong = evaluateGuess(target, "Rue Paradis", features);
  assert.equal(wrong.success, false);
  assert.ok(wrong.distanceMeters > 1000);
  assert.throws(
    () => evaluateGuess(target, "Inventée", features),
    /introuvable/,
  );
});
function session() {
  return {
    id: crypto.randomUUID(),
    mode: "ville",
    game_type: "classique",
    targets: ["Rue Sainte"],
    answers: [],
    started_at: new Date(10000),
    target_started_at: new Date(10000),
    paused_ms: 0,
    target_paused_ms: 0,
  };
}
test("Camino ignores claimed correctness and points, rejects out-of-order and paused answers", () => {
  const row = session(),
    requestId = crypto.randomUUID();
  const answer = validateSelection(
    row,
    {
      index: 0,
      requestId,
      answerName: "Rue Paradis",
      correct: true,
      points: 1000000,
    },
    12000,
  );
  assert.equal(answer.correct, false);
  assert.equal(answer.points, 0);
  assert.throws(
    () =>
      validateSelection(
        row,
        { index: 2, requestId, answerName: "Rue Sainte" },
        12000,
      ),
    /séquence/,
  );
  row.paused_at = new Date();
  assert.throws(
    () =>
      validateSelection(
        row,
        { index: 0, requestId, answerName: "Rue Sainte" },
        12000,
      ),
    /pause/,
  );
});
test("server receipts replay without a second score; incomplete classic sessions are rejected", () => {
  const row = session(),
    requestId = crypto.randomUUID();
  assert.throws(() => scoreSession(row, 12000), /incomplète/);
  row.answers = [
    validateSelection(
      row,
      { index: 0, requestId, answerName: "Rue Sainte" },
      12000,
    ),
  ];
  assert.deepEqual(
    validateSelection(
      row,
      { index: 0, requestId, answerName: "Rue Sainte" },
      13000,
    ),
    { replay: row.answers[0] },
  );
  assert.equal(scoreSession(row, 13000).score, 9);
  assert.equal(scoreSession(row, 13000).itemsCorrect, 1);
});
