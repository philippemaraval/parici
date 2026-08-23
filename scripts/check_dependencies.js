#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { builtinModules } = require("module");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const lock = JSON.parse(
  fs.readFileSync(path.join(root, "package-lock.json"), "utf8"),
);
const declared = new Set([
  ...Object.keys(manifest.dependencies || {}),
  ...Object.keys(manifest.devDependencies || {}),
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);
const failures = [];

const backendManifestPath = path.join(root, "backend", "package.json");
const backendLockPath = path.join(root, "backend", "package-lock.json");
if (fs.existsSync(backendLockPath)) {
  failures.push("backend/ contient un lockfile concurrent.");
}
if (fs.existsSync(backendManifestPath)) {
  const backendManifest = JSON.parse(
    fs.readFileSync(backendManifestPath, "utf8"),
  );
  const hasDependencies =
    Object.keys(backendManifest.dependencies || {}).length > 0 ||
    Object.keys(backendManifest.devDependencies || {}).length > 0;
  const expectedPostinstall =
    "npm ci --prefix .. --include=dev --ignore-scripts && npm run build --prefix ..";
  if (
    hasDependencies ||
    backendManifest.scripts?.postinstall !== expectedPostinstall
  ) {
    failures.push(
      "backend/package.json doit rester un lanceur Render sans dépendances et construire le frontend.",
    );
  }
}

const lockedRoot = lock.packages?.[""] || {};
for (const section of ["dependencies", "devDependencies"]) {
  const expected = manifest[section] || {};
  const actual = lockedRoot[section] || {};
  for (const dependency of Object.keys(expected)) {
    if (!actual[dependency]) {
      failures.push(
        `${dependency} manque dans package-lock.json (${section}).`,
      );
    }
  }
}

const sourceRoots = ["backend", "scripts"];
const files = sourceRoots.flatMap((directory) =>
  execFileSync(
    "git",
    ["ls-files", `${directory}/**/*.js`, `${directory}/*.js`],
    {
      cwd: root,
      encoding: "utf8",
    },
  )
    .trim()
    .split("\n")
    .filter(Boolean),
);
const externalImports = new Set();
for (const relativePath of files) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  for (const match of source.matchAll(/require\(["']([^"']+)["']\)/g)) {
    const specifier = match[1];
    if (specifier.startsWith(".") || specifier.startsWith("/")) continue;
    externalImports.add(
      specifier.startsWith("@")
        ? specifier.split("/").slice(0, 2).join("/")
        : specifier.split("/")[0],
    );
  }
}
for (const dependency of [...externalImports].sort()) {
  if (!declared.has(dependency)) {
    failures.push(`Dépendance utilisée mais non déclarée : ${dependency}.`);
  }
}

const trackedArtifacts = execFileSync(
  "git",
  ["ls-files", "dist/**", "data/map/**", "*.min.js", "*.min.css", "*.map"],
  { cwd: root, encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter(Boolean);
if (trackedArtifacts.length) {
  failures.push(
    `Artefacts générés encore versionnés : ${trackedArtifacts.slice(0, 5).join(", ")}`,
  );
}

if (failures.length) {
  failures.forEach((failure) => console.error(`✗ ${failure}`));
  process.exit(1);
}
console.log(
  `✓ Dépendances centralisées, lock cohérent, ${externalImports.size} imports contrôlés, aucun artefact versionné.`,
);
