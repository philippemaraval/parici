const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const { createTestDatabase } = require("./test-database");
const root = path.resolve(__dirname, "../..");
const read = (file) =>
  JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const normalize = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’`´]/g, "'")
    .replace(/[-‐‑‒–—]/g, "-")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ");
const loadModule = (file) =>
  import(
    `data:text/javascript;base64,${Buffer.from(fs.readFileSync(path.join(root, file), "utf8")).toString("base64")}`
  );

test(
  "all 20 arrondissements and every zone launch classic, marathon and chrono sessions",
  {
    skip: !process.env.TEST_DATABASE_URL,
    timeout: 180000,
  },
  async (t) => {
    const isolated = await createTestDatabase(
      process.env.TEST_DATABASE_URL,
      "parici_launch",
    );
    process.env.DATABASE_URL = isolated.url;
    process.env.NODE_ENV = "test";
    process.env.SECRET_KEY =
      "parici-launch-test-secret-with-thirty-two-characters";
    const db = require("../../backend/database");
    const { app, initializeDatabase } = require("../../backend/server");
    const server = http.createServer(app);
    t.after(async () => {
      if (server.listening)
        await new Promise((resolve) => server.close(resolve));
      await db.pool.end();
      await isolated.cleanup();
    });
    await initializeDatabase({ startBackgroundServices: false });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    let token;
    async function post(url, body) {
      const response = await fetch(base + url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    }
    const user = await post("/api/register", {
      username: "launch_matrix",
      password: "integration-password",
      recoveryEmail: "launch@example.test",
    });
    assert.equal(user.status, 200, JSON.stringify(user.body));
    token = user.body.token;

    // Load the actual browser catalogue and its quartier-to-arrondissement conversion.
    const originalFetch = globalThis.fetch;
    const streets = read("data/paris_rues_light.geojson");
    globalThis.fetch = async (url) => {
      if (String(url).includes("manifest.json"))
        return Response.json({}, { status: 404 });
      return Response.json(
        String(url).includes("paris_quartiers")
          ? read("data/paris_quartiers.geojson")
          : streets,
      );
    };
    let allStreetFeatures;
    try {
      const runtime = await loadModule("src/map-runtime.js");
      ({ allStreetFeatures } = await runtime.loadStreetsRuntime({
        map: {},
        L: {
          geoJSON: () => ({
            addTo() {
              return this;
            },
            addData() {},
          }),
        },
        normalizeName: normalize,
      }));
    } finally {
      globalThis.fetch = originalFetch;
    }
    const core = await loadModule("src/map-session-core.js");
    const rules = require("../../data_rules");
    const zones = [
      "ville",
      "rues-principales",
      "rues-celebres",
      "monuments",
      "stations-metro",
      "arrondissements-ville",
      "lignes-transports-idf",
      ...Array.from({ length: 20 }, (_, i) =>
        i === 0 ? "1er arrondissement" : `${i + 1}e arrondissement`,
      ),
    ];
    for (const zone of zones) {
      for (const gameType of ["classique", "marathon", "chrono"]) {
        await t.test(`${zone} / ${gameType}`, async () => {
          const mode = zone.endsWith(" arrondissement")
            ? "arrondissement"
            : zone;
          const selected = mode === "arrondissement" ? zone : null;
          const availableNames =
            mode === "stations-metro"
              ? read("data/paris_metro_stations.geojson").features.map(
                  (f) => f.properties.name,
                )
              : mode === "monuments"
                ? read("data/paris_monuments.geojson").features.map(
                    (f) => f.properties.name,
                  )
                : mode === "arrondissements-ville"
                  ? read("data/paris_quartiers.geojson").features.map(
                      (f) => f.properties.l_qu || f.properties.nom_qua,
                    )
                  : mode === "lignes-transports-idf"
                    ? read("data/paris_transit_lines.geojson").features.map(
                        (f) => f.properties.name,
                      )
                    : core
                        .buildUniqueStreetList(
                          core.getCurrentZoneStreets({
                            allStreetFeatures,
                            zoneMode: mode,
                            selectedArrondissement: selected,
                            normalizeName: normalize,
                            mainStreetNames: new Set(
                              [...rules.MAIN_STREET_NAMES].map(normalize),
                            ),
                            famousStreetNames: new Set(
                              [...rules.FAMOUS_STREET_NAMES].map(normalize),
                            ),
                          }),
                          normalize,
                        )
                        .map((f) => f.properties.name);
          const started = await post("/api/game-sessions", {
            mode,
            gameType,
            arrondissementName: selected,
            availableNames,
          });
          assert.equal(started.status, 201, JSON.stringify(started.body));
          assert.ok(started.body.targets.length > 0);
          const keys = new Set(availableNames.map(normalize));
          for (const target of started.body.targets)
            assert.ok(keys.has(normalize(target)), target);
          assert.equal(
            new Set(started.body.targets.map(normalize)).size,
            started.body.targets.length,
          );
          if (gameType === "classique")
            assert.equal(started.body.targets.length, Math.min(20, keys.size));
          const answer = await post(
            `/api/game-sessions/${started.body.sessionId}/answers`,
            {
              index: 0,
              requestId: crypto.randomUUID(),
              answerName: started.body.targets[0],
            },
          );
          assert.equal(answer.status, 200, JSON.stringify(answer.body));
          assert.equal(answer.body.correct, true);
        });
      }
    }
  },
);
