const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("le lanceur Render installe les dépendances centralisées", () => {
  const backendPackage = JSON.parse(
    fs.readFileSync(path.join(root, "backend", "package.json"), "utf8"),
  );
  const rootPackage = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  const renderBlueprint = fs.readFileSync(
    path.join(root, "render.yaml"),
    "utf8",
  );

  assert.equal(backendPackage.dependencies, undefined);
  assert.equal(backendPackage.devDependencies, undefined);
  assert.equal(
    backendPackage.scripts.postinstall,
    "npm ci --prefix .. --include=dev --ignore-scripts && npm run build --prefix ..",
  );
  assert.equal(backendPackage.scripts.start, "node server.js");
  assert.equal(
    fs.existsSync(path.join(root, "backend", "package-lock.json")),
    false,
  );
  assert.match(renderBlueprint, /rootDir: backend/);
  assert.match(renderBlueprint, /buildCommand: npm run postinstall/);
  assert.doesNotMatch(renderBlueprint, /buildCommand: npm ci(?:\s|$)/);
  assert.match(renderBlueprint, /key: PUSH_STREAK_REMINDER_HOUR\s+value: "16"/);

  for (const dependency of [
    "bcrypt",
    "express",
    "express-openapi-validator",
    "pg",
  ]) {
    assert.ok(
      rootPackage.dependencies[dependency],
      `${dependency} doit rester déclaré à la racine`,
    );
  }
});
