#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_INDEX_PATH = path.join(ROOT_DIR, "backend", "data", "streets_index.json");
const DEFAULT_OUTPUT_PATH = path.join(ROOT_DIR, "data", "daily_images", "manifest_next_30.csv");
const BACKEND_MANIFEST_PATH = path.join(
  ROOT_DIR,
  "backend",
  "data",
  "daily_images",
  "manifest_next_30.csv",
);
const DEFAULT_DAYS = 120;

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    args[token.slice(2)] = argv[index + 1];
    index += 1;
  }
  return args;
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’'`´]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function dateString(date) {
  return date.toISOString().slice(0, 10);
}

function seededRank(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function buildStreetPool(entries) {
  const unique = new Map();
  for (const entry of entries) {
    const name = String(entry?.name || "").trim();
    const normalized = normalizeName(name);
    if (!name || !normalized || unique.has(normalized)) continue;
    unique.set(normalized, {
      name,
      arrondissement: String(entry?.arrondissement || entry?.quartier || "").trim(),
      normalized,
    });
  }
  return [...unique.values()].sort(
    (left, right) =>
      seededRank(left.normalized) - seededRank(right.normalized) ||
      left.name.localeCompare(right.name, "fr"),
  );
}

function buildBalancedSchedule(pool, days, seed) {
  const exclusionWindowDays = 12;
  const streetsByArrondissement = new Map();
  for (const street of pool) {
    if (!street.arrondissement) continue;
    if (!streetsByArrondissement.has(street.arrondissement)) {
      streetsByArrondissement.set(street.arrondissement, []);
    }
    streetsByArrondissement.get(street.arrondissement).push(street);
  }

  const arrondissements = [...streetsByArrondissement.keys()];
  if (arrondissements.length < 2) {
    throw new Error("At least two arrondissements are required for a balanced Daily schedule.");
  }

  for (const [arrondissement, streets] of streetsByArrondissement) {
    streets.sort(
      (left, right) =>
        seededRank(`${seed}:${arrondissement}:${left.normalized}`) -
          seededRank(`${seed}:${arrondissement}:${right.normalized}`) ||
        left.name.localeCompare(right.name, "fr"),
    );
  }

  const schedule = [];
  const offsets = new Map(arrondissements.map((arrondissement) => [arrondissement, 0]));
  const usageCounts = new Map(arrondissements.map((arrondissement) => [arrondissement, 0]));
  while (schedule.length < days) {
    const recentlyUsed = new Set(
      schedule.slice(-exclusionWindowDays).map((street) => street.arrondissement),
    );
    const eligible = arrondissements
      .filter((arrondissement) => !recentlyUsed.has(arrondissement))
      .sort(
      (left, right) =>
        usageCounts.get(left) - usageCounts.get(right) ||
        seededRank(`${seed}:day:${schedule.length}:${left}`) -
          seededRank(`${seed}:day:${schedule.length}:${right}`) ||
        left.localeCompare(right, "fr"),
    );
    if (!eligible.length) {
      throw new Error(`No arrondissement available after ${schedule.length} scheduled days.`);
    }

    const arrondissement = eligible[0];
    const streets = streetsByArrondissement.get(arrondissement);
    const offset = offsets.get(arrondissement);
    schedule.push(streets[offset % streets.length]);
    offsets.set(arrondissement, offset + 1);
    usageCounts.set(arrondissement, usageCounts.get(arrondissement) + 1);
  }
  return schedule;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const start = args.from ? new Date(`${args.from}T12:00:00Z`) : new Date();
  const days = Math.max(1, Number.parseInt(args.days || DEFAULT_DAYS, 10));
  const indexPath = path.resolve(args.index || DEFAULT_INDEX_PATH);
  const outputPath = path.resolve(args.output || DEFAULT_OUTPUT_PATH);
  if (Number.isNaN(start.getTime())) throw new Error("Invalid --from date (expected YYYY-MM-DD).");

  const entries = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  const pool = buildStreetPool(entries);
  if (pool.length < days) {
    throw new Error(`Not enough unique streets: ${pool.length} available for ${days} days.`);
  }
  const schedule = buildBalancedSchedule(pool, days, dateString(start));

  const rows = [["date", "street_name", "arrondissement", "file_name", "missing_image_street"]];
  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + offset);
    const street = schedule[offset];
    const day = dateString(date);
    rows.push([
      day,
      street.name,
      street.arrondissement,
      `${day}__${street.normalized}.jpg`,
      "",
    ]);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const csv = `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
  fs.writeFileSync(outputPath, csv);
  if (outputPath === DEFAULT_OUTPUT_PATH) {
    fs.mkdirSync(path.dirname(BACKEND_MANIFEST_PATH), { recursive: true });
    fs.writeFileSync(BACKEND_MANIFEST_PATH, csv);
  }
  console.log(`Wrote ${days} Daily targets to ${outputPath}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
