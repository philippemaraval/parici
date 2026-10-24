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

test("transport lines are not loaded automatically during startup", () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, "../src/app.js"),
    "utf8",
  );

  assert.doesNotMatch(
    appSource,
    /scheduleAfterStartup\(\(\) => \{\s*loadBusLines\(\);/,
  );
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

test("transport paths use a tolerant canvas and reuse Collect's supplied renderer", async () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/map-runtime.js"),
    "utf8",
  );
  const { loadBusLinesRuntime } = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  );
  const runtimeBusLines = {
    features: [
      {
        properties: { name: "A", color: "ff0000" },
        geometry: {
          type: "LineString",
          coordinates: [
            [2.3, 48.8],
            [2.4, 48.9],
          ],
        },
      },
    ],
  };
  let canvasOptions;
  const canvas = {};
  const L = {
    featureGroup: () => ({
      layers: [],
      on() {},
      addLayer(layer) {
        this.layers.push(layer);
      },
      eachLayer(callback) {
        this.layers.forEach(callback);
      },
    }),
    canvas: (options) => {
      canvasOptions = options;
      return canvas;
    },
    polyline: (points, options) => ({
      options,
      on() {},
      setOffset(offset) {
        this.options.offset = offset;
      },
      getLatLngs() {
        return points;
      },
    }),
  };
  const options = {
    L,
    map: { on() {}, getZoom: () => 16 },
    runtimeBusLines,
    uiTheme: { mapBusLine: "#ff0000" },
    handleBusLineClick() {},
  };
  const standard = await loadBusLinesRuntime(options);
  assert.ok(canvasOptions.tolerance >= 5);
  assert.equal(standard.busLinesLayer.layers[0].options.renderer, canvas);
  assert.equal(
    standard.busLinesLayer.layers[0].options.bubblingMouseEvents,
    false,
  );
  const sharedRenderer = {};
  const collect = await loadBusLinesRuntime({
    ...options,
    renderer: sharedRenderer,
    isTouchDevice: true,
  });
  for (const layer of collect.busLinesLayer.layers) {
    assert.equal(layer.options.renderer, sharedRenderer);
    assert.equal(layer.options.bubblingMouseEvents, false);
  }
  const [visible, touch] = collect.busLinesLayer.layers;
  assert.equal(touch.options.offset, visible.options.offset);
});
