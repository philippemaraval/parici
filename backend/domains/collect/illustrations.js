"use strict";
const fs = require("node:fs");
const path = require("node:path");
const manifestPath = path.resolve(
  __dirname,
  "../../../data/collect_images/manifest.json",
);
let manifest;
function loadManifest() {
  if (!manifest)
    manifest = fs.existsSync(manifestPath)
      ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
      : {};
  return manifest;
}
function verifiedEntry(family, name) {
  const entry = loadManifest()[`${family}:${name}`];
  if (
    family === "bus" &&
    entry?.source !== "camino" &&
    entry?.verifiedEntity !== `bus:${name}`
  )
    return null;
  return entry;
}
function imageForCollectCard(family, name, fallback = null) {
  return (
    verifiedEntry(family, name)?.image ||
    (family === "bus" ? null : fallback) ||
    "/apple-touch-icon.png"
  );
}
function illustrationFor(family, name) {
  const entry = verifiedEntry(family, name);
  return entry
    ? {
        source: entry.source,
        caption: entry.caption || null,
        sourcePage: entry.sourcePage || null,
        author: entry.author || null,
        license: entry.license || null,
      }
    : { source: "camino", sourcePage: null, author: null, license: null };
}
module.exports = { illustrationFor, imageForCollectCard };
