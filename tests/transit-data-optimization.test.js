const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const {
  optimizeGeometryLines,
  simplifyLine,
} = require("../scripts/sync_paris_transit_lines.js");

test("transit line simplification keeps endpoints and meaningful bends", () => {
  const line = [
    [2, 48],
    [2.000001, 48.000001],
    [2.001, 48.002],
    [2.002, 48.002],
  ];

  assert.deepEqual(simplifyLine(line), [
    [2, 48],
    [2.001, 48.002],
    [2.002, 48.002],
  ]);
});

test("transit geometry optimization removes reversed duplicate ways", () => {
  const line = [
    [2, 48],
    [2.001, 48.001],
    [2.002, 48.002],
  ];

  assert.deepEqual(optimizeGeometryLines([line, [...line].reverse()]), [
    [
      [2, 48],
      [2.002, 48.002],
    ],
  ]);
});

test("transport lines are rendered on demand with canvas", () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, "../src/app.js"),
    "utf8",
  );
  const mapRuntimeSource = fs.readFileSync(
    path.join(__dirname, "../src/map-runtime.js"),
    "utf8",
  );

  assert.doesNotMatch(
    appSource,
    /scheduleAfterStartup\(\(\) => \{\s*loadBusLines\(\);/,
  );
  assert.match(mapRuntimeSource, /const busLineRenderer = L\.canvas/);
  assert.match(mapRuntimeSource, /renderer: busLineRenderer/);
});

test("a transport session loads its lines before starting the game", async () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, "../src/app.js"),
    "utf8",
  );
  const preparation = appSource.slice(
    appSource.indexOf("async function prepareAndStartNewSession() {"),
    appSource.indexOf("async function initializeApplication()"),
  );
  let release;
  const loading = new Promise((resolve) => {
    release = resolve;
  });
  let loadCount = 0;
  let started = 0;
  let loaded = false;
  const context = vm.createContext({
    sessionLaunchPending: false,
    isSessionRunning: false,
    currentUser: null,
    getZoneMode: () => "lignes-transports-idf",
    getGameMode: () => "classique",
    isPointZone: () => false,
    updateStartStopButton: () => {},
    loadBusLines: async () => {
      loadCount++;
      await loading;
      loaded = true;
    },
    startNewSession: () => {
      assert.equal(
        loaded,
        true,
        "the map catalogue must be ready before entering the game",
      );
      started++;
    },
    showMessage: (message) => assert.fail(message),
  });
  vm.runInContext(preparation, context);
  assert.equal(loadCount, 0);
  const pending = context.prepareAndStartNewSession();
  assert.equal(loadCount, 1);
  assert.equal(started, 0);
  release();
  await pending;
  assert.equal(started, 1);
  assert.equal(context.sessionLaunchPending, false);
});
