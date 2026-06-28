#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const manifestPath = path.join(ROOT, "data", "daily_images", "manifest_next_30.csv");
const imageDir = path.dirname(manifestPath);
const rows = fs.readFileSync(manifestPath, "utf8").trim().split(/\r?\n/).slice(1);
const missing = [];
const obsolete = [];

for (const row of rows) {
  const cells = row.match(/(?:^|,)(?:"((?:[^"]|"")*)"|([^",]*))/g)
    .map((cell) => cell.replace(/^,/, "").replace(/^"|"$/g, "").replace(/""/g, '"'));
  const [date, , , fileName, missingImageStreet] = cells;
  if (!fileName || !fs.existsSync(path.join(imageDir, fileName))) {
    missing.push({ date, fileName });
  }
  if (missingImageStreet) obsolete.push({ date, replacementFor: missingImageStreet });
}

const report = {
  targets: rows.length,
  imagesPresent: rows.length - missing.length,
  missing: missing.length,
  obsolete: obsolete.length,
  missingDates: missing.map((entry) => entry.date),
  obsoleteEntries: obsolete,
};
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes("--strict") && (missing.length || obsolete.length)) process.exitCode = 1;
