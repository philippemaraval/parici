"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const { resolveStreetGroups } = require("../backend/domains/collect/rules");
const { FAMOUS_STREET_NAMES, MAIN_STREET_NAMES } = require("../data_rules");
const { shouldKeepStreetForGame } = require("../street_filter");
function parseCsv(raw) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    const next = raw[index + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
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
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(field);
      if (row.some((value) => value.trim())) {
        rows.push(row);
      }
      row = [];
      field = "";
      continue;
    }
    field += char;
  }

  row.push(field);
  if (row.some((value) => value.trim())) {
    rows.push(row);
  }

  return rows;
}

function validateCatalog(catalog, index) {
  const groups = resolveStreetGroups(index, {
    famousStreets: [...FAMOUS_STREET_NAMES],
    mainStreets: [...MAIN_STREET_NAMES],
  });
  const expected = {
    "famous-streets": new Set(groups.famous),
    "main-streets": new Set(groups.main),
  };
  const errors = [];
  for (const [slug, names] of Object.entries(expected)) {
    const actual = new Set(
      catalog.records
        .filter((c) => c.family === "street" && c.album_slugs.includes(slug))
        .map((c) => c.source_entity_id),
    );
    for (const name of names)
      if (!actual.has(name)) errors.push(`${slug}: ${name} absent`);
    for (const name of actual)
      if (!names.has(name)) errors.push(`${slug}: ${name} classé à tort`);
  }
  return errors;
}
function validatePlayerContent(root = path.resolve(__dirname, "..")) {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f), "utf8"));
  const index = read("backend/data/streets_index.json").filter((s) =>
    shouldKeepStreetForGame({ name: s.name, osm_name: s.osmName }),
  );
  const catalog = read("data/collect_paris_catalog.json"),
    errors = validateCatalog(catalog, index);
  const key = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  const names = new Set(index.flatMap((x) => [key(x.name), key(x.osmName)]));
  const manifest = fs.readFileSync(
    path.join(root, "data/daily_images/manifest_next_30.csv"),
    "utf8",
  );
  if (
    manifest !==
    fs.readFileSync(
      path.join(root, "backend/data/daily_images/manifest_next_30.csv"),
      "utf8",
    )
  )
    errors.push("Manifestes Daily différents");
  const [headers, ...rows] = parseCsv(manifest);
  const today = new Intl.DateTimeFormat("fr-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  for (const row of rows) {
    const entry = Object.fromEntries(headers.map((h, i) => [h, row[i]]));
    if (
      entry.date >= today &&
      (!names.has(key(entry.street_name)) ||
        !shouldKeepStreetForGame({ name: entry.street_name }))
    )
      errors.push(
        `${entry.date}: rue Daily introuvable ou exclue (${entry.street_name})`,
      );
    if (
      !fs.existsSync(
        path.join(root, "data/daily_images", entry.file_name || "__missing__"),
      )
    )
      errors.push(`${entry.date}: photo Daily absente`);
  }
  if (errors.length) throw new Error(errors.join("\n"));
  return {
    cards: catalog.records.length,
    dailyTargets: rows.length,
    famous: catalog.records.filter((c) =>
      c.album_slugs.includes("famous-streets"),
    ).length,
    main: catalog.records.filter((c) => c.album_slugs.includes("main-streets"))
      .length,
  };
}
if (require.main === module) {
  try {
    console.log("Contenus vérifiés :", validatePlayerContent());
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
module.exports = { validatePlayerContent, validateCatalog, parseCsv };
