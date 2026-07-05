const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const FIRST_FUTURE_MANIFEST_DATE = "2026-07-05";

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function parseManifestRows() {
  const lines = fs
    .readFileSync(path.join(ROOT, "data/daily_images/manifest_next_30.csv"), "utf8")
    .trim()
    .split(/\r?\n/);
  const headers = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const columns = line.split(",");
    return Object.fromEntries(headers.map((header, index) => [header, columns[index] || ""]));
  });
}

test("every future Daily manifest street resolves through its canonical or OSM name", () => {
  const streetIndex = JSON.parse(
    fs.readFileSync(path.join(ROOT, "backend/data/streets_index.json"), "utf8"),
  );
  const exact = new Map(streetIndex.map((entry) => [normalize(entry.name), entry]));
  const aliases = new Map();
  streetIndex.forEach((entry) => {
    const key = normalize(entry.osmName || entry.name);
    if (!aliases.has(key)) aliases.set(key, []);
    aliases.get(key).push(entry);
  });

  const unresolved = parseManifestRows()
    .filter((row) => row.date >= FIRST_FUTURE_MANIFEST_DATE)
    .filter((row) => {
      if (exact.has(normalize(row.street_name))) return false;
      const candidates = aliases.get(normalize(row.street_name)) || [];
      const quartierMatch = candidates.find(
        (entry) => normalize(entry.quartier) === normalize(row.quartier),
      );
      return !quartierMatch && candidates.length !== 1;
    })
    .map((row) => `${row.date}: ${row.street_name} (${row.quartier})`);

  assert.deepEqual(unresolved, []);
});
