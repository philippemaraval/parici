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
const DATA_RULES_PATH = path.join(ROOT_DIR, "data_rules.js");
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

function buildStreetPool(entries, preferredNames) {
  const unique = new Map();
  for (const entry of entries) {
    const name = String(entry?.name || "").trim();
    const normalized = normalizeName(name);
    if (
      !name ||
      !normalized ||
      unique.has(normalized) ||
      (preferredNames.size && !preferredNames.has(normalized))
    ) continue;
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const start = args.from ? new Date(`${args.from}T12:00:00Z`) : new Date();
  const days = Math.max(1, Number.parseInt(args.days || DEFAULT_DAYS, 10));
  const indexPath = path.resolve(args.index || DEFAULT_INDEX_PATH);
  const outputPath = path.resolve(args.output || DEFAULT_OUTPUT_PATH);
  if (Number.isNaN(start.getTime())) throw new Error("Invalid --from date (expected YYYY-MM-DD).");

  const entries = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  const rules = fs.existsSync(DATA_RULES_PATH) ? require(DATA_RULES_PATH) : {};
  const preferredNames = new Set(
    [...(rules.FAMOUS_STREET_NAMES || []), ...(rules.MAIN_STREET_NAMES || [])].map(normalizeName),
  );
  const pool = buildStreetPool(entries, preferredNames);
  if (pool.length < days) {
    throw new Error(`Not enough unique streets: ${pool.length} available for ${days} days.`);
  }

  const rows = [["date", "street_name", "quartier", "file_name", "missing_image_street"]];
  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + offset);
    const street = pool[offset];
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
