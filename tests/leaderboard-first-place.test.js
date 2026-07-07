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
  const deployedCss = read("dist/style.css");

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
  const assetVersion = "20260707-v040";

  assert.match(read("index.html"), new RegExp(`style\\.css\\?v=${assetVersion}`));
  assert.match(read("dist/index.html"), new RegExp(`style\\.css\\?v=${assetVersion}`));
  assert.match(read("index.html"), new RegExp(`main\\.js\\?v=${assetVersion}`));
  assert.match(read("dist/index.html"), new RegExp(`main\\.js\\?v=${assetVersion}`));
  assert.match(read("sw.js"), new RegExp(`style\\.css\\?v=${assetVersion}`));
  assert.match(read("dist/sw.js"), new RegExp(`style\\.css\\?v=${assetVersion}`));
});
