const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("the service worker is never covered by immutable JavaScript headers", () => {
  const headers = read("_headers");
  assert.match(
    headers,
    /\/sw\.js\s+Cache-Control: no-cache, no-store, must-revalidate/,
  );
  assert.match(
    headers,
    /\/assets\/\*\s+Cache-Control: public, max-age=604800, immutable/,
  );
  assert.doesNotMatch(headers, /^\/\*\.js$/m);
});

test("an installed app checks for updates when it is reopened or resumed", () => {
  const app = read("src/app.js");
  assert.match(app, /\.register\("\/sw\.js", \{ updateViaCache: "none" \}\)/);
  assert.match(app, /navigator\.serviceWorker\.addEventListener\("controllerchange"/);
  assert.match(app, /swControllerReloadTriggered = true;\s*window\.location\.reload\(\)/);
  assert.match(
    app,
    /window\.addEventListener\("pageshow", \(\) => \{\s*monitorBackendAvailability\(\);\s*requestServiceWorkerUpdate\(\)/,
  );
  assert.match(
    app,
    /document\.visibilityState === "visible"[\s\S]*requestServiceWorkerUpdate\(\)/,
  );
});
