const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("current Paris OSM artifacts pass the same cross-validation used by automation", () => {
  const { validateOsmOutputs } = require("../scripts/validate_osm_outputs");
  const result = validateOsmOutputs(ROOT);

  assert.ok(result.lightSegments >= 5000);
  assert.ok(result.enrichedSegments >= result.lightSegments);
  assert.ok(result.uniqueStreets >= 2000);
});

test("scheduled and admin OSM paths share the validated sync script", () => {
  const workflow = read(".github/workflows/sync-osm.yml");
  const backend = read("backend/server.js");
  const admin = read("admin/home.js");
  const syncScript = read("scripts/sync_osm.js");

  assert.match(workflow, /schedule:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /npm run validate:osm/);
  assert.match(workflow, /git pull --rebase origin main/);
  assert.match(workflow, /git push origin main/);
  assert.doesNotMatch(workflow, /create-pull-request/);
  assert.match(backend, /actions\/workflows\/\$\{encodedWorkflowId\}\/dispatches/);
  assert.match(backend, /inputs:\s*\{\s*source: requestedBy/);
  assert.match(admin, /body: \{ target: "github" \}/);
  assert.match(admin, /window\.setTimeout\(pollOnce, OSM_SYNC_POLL_INTERVAL_MS\)/);
  assert.match(syncScript, /validateOsmOutputs/);
});

test("a verified OSM rename preserves published card and Daily identities without conflating other streets", () => {
  const { applyStreetIdentityAliases, buildLightFeatures, buildStreetIndex } = require("../scripts/sync_osm");
  const original = JSON.parse(read("data/paris_rues_enrichi.geojson")).features.find((f) => f.properties.osm_id === "way/253867538");
  const renamed = structuredClone(original);
  renamed.name = renamed.properties.name = renamed.properties.osm_tags.name = "Place Aimée Millot";
  const differentObject = structuredClone(renamed);
  differentObject.properties.osm_id = "way/other-object";
  const futureRename = structuredClone(renamed);
  futureRename.properties.name = "Unverified future name";
  applyStreetIdentityAliases([renamed, differentObject, futureRename]);
  assert.equal(renamed.properties.name, "Place de la Bergère d'Ivry");
  assert.equal(renamed.properties.osm_name, "Place Aimée Millot");
  assert.equal(renamed.properties.osm_tags.name, "Place Aimée Millot");
  assert.deepEqual(renamed.geometry, original.geometry);
  assert.equal(differentObject.properties.name, "Place Aimée Millot");
  assert.equal(futureRename.properties.name, "Unverified future name");
  const [entry] = buildStreetIndex(buildLightFeatures([renamed]));
  assert.equal(entry.name, "Place de la Bergère d'Ivry");
  assert.equal(entry.osmName, "Place Aimée Millot");
  assert.deepEqual(entry.centroid, original.properties.centroid);
});
