const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const catalog = JSON.parse(
  require("node:fs").readFileSync(
    require("node:path").join(
      __dirname,
      "../data/paris_metro_stations.geojson",
    ),
    "utf8",
  ),
);
const { buildMetroStations } = require("../scripts/sync_paris_metro_stations");
const {
  start,
  validateSelection,
  scoreSession,
} = require("../backend/domains/game-integrity/sessions");

test("metro catalogue contains unique station points, without funicular or future line 18", () => {
  const features = catalog.features;
  assert.equal(features.length, 321);
  assert.equal(
    new Set(features.map((f) => f.properties.name)).size,
    features.length,
  );
  for (const f of features) {
    assert.equal(f.geometry.type, "Point");
    assert.equal(f.properties.mode, "metro");
    const [lon, lat] = f.geometry.coordinates;
    assert.ok(lon > 2 && lon < 2.6 && lat > 48.7 && lat < 49);
    assert.doesNotMatch(
      f.properties.name,
      /Funiculaire|Christ de Saclay|Polytechnique/,
    );
  }
  assert.ok(
    features.some((f) => f.properties.name === "Villejuif - Gustave Roussy"),
  );
  assert.ok(features.some((f) => f.properties.name === "Aéroport d'Orly"));
});
test("IDFM platforms merge by station; non-metro stops and the funicular are excluded", () => {
  const row = {
    arrtype: "metro",
    zdaid: "1",
    arrname: "Bastille",
    arrgeopoint: { lon: 2.36, lat: 48.85 },
  };
  const data = buildMetroStations([
    row,
    { ...row, arrgeopoint: { lon: 2.38, lat: 48.87 } },
    { ...row, zdaid: "2", arrtype: "tram" },
    { ...row, zdaid: "3", arrname: "Funiculaire Gare haute" },
  ]);
  assert.equal(data.features.length, 1);
  assert.deepEqual(data.features[0].geometry.coordinates, [2.37, 48.86]);
});
for (const gameType of ["classique", "marathon", "chrono"]) {
  test(`verified metro ${gameType} sessions use the station catalogue and score answers`, async () => {
    let insert;
    const db = {
      pool: {
        query: async (_sql, values) => {
          insert = values;
          return { rows: [] };
        },
      },
    };
    const body = {
      mode: "stations-metro",
      gameType,
      availableNames: catalog.features.map((f) => f.properties.name),
    };
    const receipt = await start(db, 1, body);
    assert.equal(receipt.targets.length, gameType === "classique" ? 20 : 321);
    assert.equal(insert[2], "stations-metro");
    assert.deepEqual(JSON.parse(insert[6]), receipt.targets);
    const now = Date.now();
    const session = {
      mode: body.mode,
      game_type: gameType,
      targets: receipt.targets,
      answers: [],
      started_at: new Date(now - 2000),
      target_started_at: new Date(now - 2000),
      paused_ms: 0,
      target_paused_ms: 0,
    };
    const answer = validateSelection(
      session,
      {
        index: 0,
        requestId: crypto.randomUUID(),
        answerName: receipt.targets[0],
      },
      now,
    );
    assert.equal(answer.correct, true);
    session.answers =
      gameType === "classique" ? receipt.targets.map(() => answer) : [answer];
    assert.equal(scoreSession(session, now).mode, "stations-metro");
    await assert.rejects(
      start(db, 1, { ...body, availableNames: ["RER inventé"] }),
      /Catalogue/,
    );
  });
}
