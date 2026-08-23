const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const { selectPreviousLiveDeploy } = require("../scripts/render_delivery");

test("le rollback cible le dernier déploiement live précédent", () => {
  const selected = selectPreviousLiveDeploy(
    [
      { deploy: { id: "new", status: "build_in_progress" } },
      { deploy: { id: "previous", status: "live" } },
      { deploy: { id: "older", status: "live" } },
    ],
    "new",
  );
  assert.equal(selected.id, "previous");
});

test("la livraison déploie directement la production après la CI", () => {
  const workflow = fs.readFileSync(
    path.join(root, ".github", "workflows", "delivery.yml"),
    "utf8",
  );
  assert.match(workflow, /environment:\s*production/);
  assert.doesNotMatch(workflow, /environment:\s*staging/);
  assert.doesNotMatch(workflow, /needs:\s*staging/);
  assert.match(workflow, /CAMINO_DELIVERY_ENABLED/);
  assert.match(workflow, /head_branch == 'main'/);
  assert.match(workflow, /conclusion == 'success'/);
  assert.match(workflow, /RENDER_PRODUCTION_SERVICE_ID/);
  assert.match(workflow, /PRODUCTION_HEALTHCHECK_URL/);
  assert.match(workflow, /scripts\/render_delivery\.js/);
});
