const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const runtime = import(
  "data:text/javascript;base64," +
    Buffer.from(
      fs.readFileSync(path.join(__dirname, "../src/map-rendering.js")),
    ).toString("base64")
);

test("map construction yields, retains all features and redraws once", async () => {
  const { buildMapLayer } = await runtime;
  const features = Array.from({ length: 1200 }, (_, id) => ({ id }));
  const added = [];
  let redraws = 0,
    ticks = 0;
  const renderer = {
    _requestRedraw() {
      redraws++;
    },
  };
  const original = renderer._requestRedraw;
  const layer = {
    addTo() {
      return this;
    },
    addData(feature) {
      added.push(feature);
      renderer._requestRedraw();
    },
  };
  const timer = setInterval(() => ticks++, 0);
  try {
    assert.equal(
      await buildMapLayer(
        { geoJSON: () => layer },
        {},
        { features },
        {},
        renderer,
      ),
      layer,
    );
    assert.deepEqual(added, features);
    assert.ok(ticks > 0, "the event loop must run during map construction");
    assert.equal(redraws, 1);
    assert.equal(renderer._requestRedraw, original);
  } finally {
    clearInterval(timer);
  }
});

test("failed construction restores the renderer and removes partial layers", async () => {
  const { buildMapLayer } = await runtime;
  const original = () => {};
  const renderer = { _requestRedraw: original };
  const layer = {
    addTo() {
      return this;
    },
    addData() {
      throw Error("bad geometry");
    },
  };
  let removed;
  await assert.rejects(
    buildMapLayer(
      { geoJSON: () => layer },
      {
        removeLayer(item) {
          removed = item;
        },
      },
      { features: [{}] },
      {},
      renderer,
    ),
    /bad geometry/,
  );
  assert.equal(removed, layer);
  assert.equal(renderer._requestRedraw, original);
});

test("selection index keeps every segment and excludes transport hit areas", async () => {
  const { indexCollectLayers } = await runtime;
  const a = { feature: { id: "A" } },
    b = { feature: { id: "A" } },
    c = { feature: { id: "B" } };
  const index = indexCollectLayers(
    {
      eachLayer(fn) {
        [a, b, c, { feature: { id: "A" }, _isBusHitArea: true }].forEach(fn);
      },
    },
    (f) => f.id,
  );
  assert.deepEqual(index.get("A"), [a, b]);
  assert.deepEqual(index.get("B"), [c]);
});

test("foreground launch can cancel speculative construction after a short batch", async () => {
  const { buildMapLayer } = await runtime;
  const controller = new AbortController();
  let added = 0,
    removed = false;
  const layer = {
    addTo() {
      return this;
    },
    addData() {
      added++;
      controller.abort();
    },
  };
  await assert.rejects(
    buildMapLayer(
      { geoJSON: () => layer },
      {
        removeLayer() {
          removed = true;
        },
      },
      { features: Array(1000).fill({}) },
      {},
      {},
      controller.signal,
    ),
    { name: "AbortError" },
  );
  assert.ok(added <= 100);
  assert.equal(removed, true);
});
