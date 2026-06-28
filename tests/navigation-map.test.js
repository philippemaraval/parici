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

test("the iOS home-screen icon is declared and included in the deploy build", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const buildScript = fs.readFileSync(path.join(root, "scripts", "build.js"), "utf8");
  assert.match(html, /rel="apple-touch-icon" sizes="180x180" href="\/apple-touch-icon\.png/);
  assert.match(html, /apple-mobile-web-app-title" content="Parici"/);
  assert.match(buildScript, /"apple-touch-icon\.png"/);
  assert.ok(fs.existsSync(path.join(root, "apple-touch-icon.png")));
});

test("map zoom keeps Leaflet animations enabled without rewriting street styles", () => {
  const app = fs.readFileSync(path.join(root, "src", "app.js"), "utf8");
  assert.doesNotMatch(app, /zoomAnimation: !1/);
  assert.doesNotMatch(app, /fadeAnimation: !1/);
  assert.doesNotMatch(app, /markerZoomAnimation: !1/);
  assert.doesNotMatch(app, /updateWhenZooming: !1/);
  assert.doesNotMatch(app, /map\.on\("zoomend", (?:synchronizeMapLayersAfterZoom|refreshStreetLayerStylesForZoom)\)/);
  assert.doesNotMatch(app, /function synchronizeMapLayersAfterZoom/);
});

test("the Daily share artwork uses the Parici green palette without a sun", () => {
  const dailyRuntime = fs.readFileSync(path.join(root, "src", "daily-runtime.js"), "utf8");
  assert.match(dailyRuntime, /fillText\("PARICI DAILY"/);
  assert.doesNotMatch(dailyRuntime, /#f2a900|#fde68a|#fff5cc|#a85a00/);
  assert.doesNotMatch(dailyRuntime, /ctx\.arc\(200, 190, 110/);
});

test("the installed application uses Parici as its exact name", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "site.webmanifest"), "utf8"));
  assert.match(html, /<title>Parici<\/title>/);
  assert.equal(manifest.name, "Parici");
  assert.equal(manifest.short_name, "Parici");
});

test("the displayed application version is V0.2.3", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const rules = fs.readFileSync(path.join(root, "regles.html"), "utf8");
  assert.match(html, />\s*V0\.2\.3\s*</);
  assert.match(rules, />V0\.2\.3</);
});
