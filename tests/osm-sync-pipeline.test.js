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
  assert.match(workflow, /git push origin "HEAD:main"/);
  assert.doesNotMatch(workflow, /create-pull-request/);
  assert.match(backend, /actions\/workflows\/\$\{encodedWorkflowId\}\/dispatches/);
  assert.match(backend, /inputs:\s*\{\s*source: requestedBy/);
  assert.match(admin, /body: \{ target: "github" \}/);
  assert.match(admin, /window\.setTimeout\(pollOnce, OSM_SYNC_POLL_INTERVAL_MS\)/);
  assert.match(syncScript, /validateOsmOutputs/);
});
