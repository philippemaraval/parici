const test = require("node:test");
const assert = require("node:assert/strict");
const {
  plaqueMatches,
  stepResult,
} = require("../backend/domains/game-integrity/explorer");
const riddles = require("../data/explorer_paris.json");
test("Explorer accepts plaque accents and minor OCR errors but rejects another Paris street", () => {
  assert.equal(
    plaqueMatches("RUE DES FRANCS BOURGEOIS", "Rue des Francs Bourgeois"),
    true,
  );
  assert.equal(
    plaqueMatches("RUE DES FRANCS BOURGE0IS", "Rue des Francs Bourgeois"),
    true,
  );
  assert.equal(plaqueMatches("RUE DE PICARDIE", "Rue de Turenne"), false);
  assert.equal(plaqueMatches("RUE DE", "Rue de Turenne"), false);
});
test("Explorer calculates time and hints on the server and rejects distant answers", () => {
  const riddle = riddles[0],
    now = Date.parse("2026-10-13T10:00:00Z");
  const answer = {
    ocr_text: riddle.street_name_clean,
    latitude: riddle.latitude,
    longitude: riddle.longitude,
    points_earned: 99999,
    hints_used: 0,
  };
  const session = { started_at: new Date(now - 120000), hint_used: true };
  const result = stepResult(answer, riddle, session, now);
  assert.equal(result.pointsEarned, 53);
  assert.equal(result.walkingTimeSeconds, 120);
  assert.equal(result.hintsUsed, 1);
  assert.throws(
    () =>
      stepResult(
        { ...answer, latitude: 43.3, longitude: 5.4 },
        riddle,
        session,
        now,
      ),
    /éloignée/,
  );
  assert.throws(() => stepResult(answer, riddle, null, now), /Démarrez/);
});
