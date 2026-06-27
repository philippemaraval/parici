const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("home, Camino, Daily and profile views are selected before first paint", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(html, /document\.documentElement\.dataset\.mobileView/);
  assert.match(html, /allowedViews = \["camino", "daily", "profile"\]/);
  assert.match(html, /href="\/\?view=camino"/);
  assert.match(html, /href="\/\?view=daily"/);
  assert.match(html, /href="\/\?view=profile#profile"/);
  assert.match(html, /href="\/regles\.html"/);
});

test("all linked standalone pages are included in the deploy build", () => {
  const buildScript = fs.readFileSync(path.join(root, "scripts", "build.js"), "utf8");
  assert.match(buildScript, /"arbre-rangs\.html"/);
  assert.match(buildScript, /"regles\.html"/);
  assert.ok(fs.existsSync(path.join(root, "arbre-rangs.html")));
  assert.ok(fs.existsSync(path.join(root, "regles.html")));
});

test("map zoom keeps tiles and vector streets on one non-animated frame", () => {
  const app = fs.readFileSync(path.join(root, "src", "app.js"), "utf8");
  assert.match(app, /zoomAnimation: !1/);
  assert.match(app, /fadeAnimation: !1/);
  assert.match(app, /updateWhenZooming: !1/);
  assert.match(app, /map\.on\("zoomend", synchronizeMapLayersAfterZoom\)/);
  assert.match(app, /layer\?\.redraw\?\.\(\)/);
});
