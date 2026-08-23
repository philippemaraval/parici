const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("Render construit et sert le frontend fingerprinté", () => {
  const backendPackage = JSON.parse(
    fs.readFileSync(path.join(root, "backend", "package.json"), "utf8"),
  );
  const serverSource = fs.readFileSync(
    path.join(root, "backend", "server.js"),
    "utf8",
  );

  assert.match(backendPackage.scripts.postinstall, /npm ci --prefix \.\./);
  assert.match(backendPackage.scripts.postinstall, /npm run build --prefix \.\./);
  assert.match(serverSource, /path\.join\(__dirname, '\.\.', 'dist'\)/);
  assert.match(serverSource, /Production frontend build not found/);
  assert.match(serverSource, /app\.get\('\/main\.js'/);
  assert.match(serverSource, /assetManifest\['main\.js'\]/);
  assert.match(serverSource, /Cache-Control', 'no-store'/);
});

test("le build référence un bundle JavaScript présent", () => {
  const distIndexPath = path.join(root, "dist", "index.html");
  if (!fs.existsSync(distIndexPath)) {
    return;
  }

  const indexHtml = fs.readFileSync(distIndexPath, "utf8");
  const mainAsset = indexHtml.match(
    /<script[^>]+src=["'](\/assets\/main\.[a-f0-9]+\.js)["']/,
  );

  assert.ok(mainAsset, "dist/index.html doit référencer le bundle fingerprinté");
  assert.ok(
    fs.existsSync(path.join(root, "dist", mainAsset[1].slice(1))),
    `${mainAsset[1]} doit exister dans dist`,
  );
});
