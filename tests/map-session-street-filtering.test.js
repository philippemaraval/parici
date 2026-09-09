const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

async function loadMapSessionCore() {
  const source = fs.readFileSync(path.join(ROOT, "src/map-session-core.js"), "utf8");
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

test("free modes keep Paris streets whose name starts with Cité", async () => {
  const { isStreetVisibleInCurrentMode } = await loadMapSessionCore();
  const shared = {
    normalizedStreetName: "cite dupont",
    arrondissementName: "Quartier Test",
    selectedArrondissement: "Quartier Test",
    famousStreetNames: new Set(),
    mainStreetNames: new Set(),
  };

  assert.equal(isStreetVisibleInCurrentMode({ ...shared, zoneMode: "ville" }), true);
  assert.equal(isStreetVisibleInCurrentMode({ ...shared, zoneMode: "arrondissement" }), true);
});
