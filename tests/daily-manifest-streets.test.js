const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const FIRST_FUTURE_MANIFEST_DATE = "2026-07-05";
const DAILY_MANIFEST_PATH = path.join(ROOT, "data/daily_images/manifest_next_30.csv");
const BACKEND_DAILY_MANIFEST_PATH = path.join(
  ROOT,
  "backend/data/daily_images/manifest_next_30.csv",
);
const DAILY_IMAGE_DIR = path.join(ROOT, "data/daily_images");
const JULY_7_IMAGE_HASH = "486e2e2639f25559827077afdf1c28be09effd539560df83ca7e4de78fd33e3e";

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function parseCsv(raw) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    const next = raw[index + 1];
    if (char === "\"") {
      if (inQuotes && next === "\"") {
        field += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += char;
  }

  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function parseManifestRows() {
  const [headers, ...lines] = parseCsv(fs.readFileSync(DAILY_MANIFEST_PATH, "utf8"));
  return lines.map((columns) => {
    return Object.fromEntries(headers.map((header, index) => [header, columns[index] || ""]));
  });
}

test("frontend and backend Daily manifests are identical", () => {
  assert.equal(
    fs.readFileSync(DAILY_MANIFEST_PATH, "utf8"),
    fs.readFileSync(BACKEND_DAILY_MANIFEST_PATH, "utf8"),
  );
});

test("every Daily manifest row has a checked-in image", () => {
  const missingImages = parseManifestRows()
    .filter((row) => !row.file_name || !fs.existsSync(path.join(DAILY_IMAGE_DIR, row.file_name)))
    .map((row) => `${row.date}: ${row.file_name || "(missing file_name)"}`);

  assert.deepEqual(missingImages, []);
});

test("2026-07-07 stays on Passage Sainte-Anne with the original photo", () => {
  const row = parseManifestRows().find((entry) => entry.date === "2026-07-07");
  assert.deepEqual(
    {
      street_name: row?.street_name,
      file_name: row?.file_name,
    },
    {
      street_name: "Passage Sainte-Anne",
      file_name: "2026-07-07__passage-sainte-anne.jpg",
    },
  );

  const imagePath = path.join(DAILY_IMAGE_DIR, row.file_name);
  const imageHash = crypto.createHash("sha256").update(fs.readFileSync(imagePath)).digest("hex");
  assert.equal(imageHash, JULY_7_IMAGE_HASH);
});

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
      const arrondissementMatch = candidates.find(
        (entry) =>
          normalize(entry.arrondissement || entry.quartier) ===
          normalize(row.arrondissement || row.quartier),
      );
      return !arrondissementMatch && candidates.length === 0;
    })
    .map((row) => `${row.date}: ${row.street_name} (${row.arrondissement || row.quartier})`);

  assert.deepEqual(unresolved, []);
});
