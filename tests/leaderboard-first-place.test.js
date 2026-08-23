const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("only explicitly ranked first-place rows receive the leaderboard winner style", () => {
  const leaderboardSource = read("src/leaderboard.js");
  const sourceCss = read("style.css");
  const assetManifest = JSON.parse(read("dist/asset-manifest.json"));
  const deployedCss = read(`dist${assetManifest["style.css"]}`);

  assert.equal(
    leaderboardSource.match(/classList\.add\("leaderboard-first-place"\)/g)?.length,
    5,
  );
  assert.match(sourceCss, /\.leaderboard-table tr\.leaderboard-first-place td/);
  assert.doesNotMatch(sourceCss, /tbody(?:\:first-of-type)? tr:first-child td/);
  assert.match(sourceCss, /\.leaderboard-table \.leaderboard-hidden-rows tr td/);
  assert.match(deployedCss, /\.leaderboard-table tr\.leaderboard-first-place td/);
  assert.doesNotMatch(deployedCss, /tbody(?:\:first-of-type)? tr:first-child td/);
  assert.match(deployedCss, /\.leaderboard-table \.leaderboard-hidden-rows tr td/);
});

test("deployed leaderboard assets use the current cache-busting version", () => {
  const manifest = JSON.parse(read("dist/asset-manifest.json"));
  const deployedIndex = read("dist/index.html");
  const deployedServiceWorker = read("dist/sw.js");

  assert.match(manifest["style.css"], /^\/assets\/style\.[a-f0-9]{12}\.css$/);
  assert.match(manifest["main.js"], /^\/assets\/main\.[a-f0-9]{12}\.js$/);
  assert.ok(deployedIndex.includes(manifest["style.css"]));
  assert.ok(deployedIndex.includes(manifest["main.js"]));
  assert.ok(deployedServiceWorker.includes(manifest["style.css"]));
  assert.ok(deployedServiceWorker.includes(manifest["main.js"]));
  assert.ok(deployedServiceWorker.includes(manifest["leaflet-runtime.js"]));
  assert.ok(deployedServiceWorker.includes(manifest["leaflet.css"]));
  assert.match(read(`dist${manifest["map-dependencies.js"]}`), /leaflet-runtime/);
  assert.doesNotMatch(
    read(`dist${manifest["map-dependencies.js"]}`),
    /unpkg\.com\/leaflet/,
  );
  assert.doesNotMatch(deployedIndex, /[?&]v=/);
});
