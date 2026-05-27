#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const INFOS_PATH = path.join(ROOT, "data", "street_infos.json");
const INPUT_FILES = [
  path.join(__dirname, "new_main_p1.json"),
  path.join(__dirname, "new_main_p2.json"),
  path.join(__dirname, "new_main_p3.json"),
  path.join(__dirname, "new_main_p4.json"),
  path.join(__dirname, "new_main_p5.json")
];

const existing = JSON.parse(fs.readFileSync(INFOS_PATH, "utf8"));

let added = 0;
let updated = 0;
let unchanged = 0;

for (const inputFile of INPUT_FILES) {
  if (!fs.existsSync(inputFile)) {
    console.warn("Input file not found, skipping:", inputFile);
    continue;
  }
  const newDescriptions = JSON.parse(fs.readFileSync(inputFile, "utf8"));
  
  for (const [key, value] of Object.entries(newDescriptions)) {
    const normalizedKey = key.toLowerCase().trim();
    if (existing.main[normalizedKey]) {
      if (existing.main[normalizedKey] !== value) {
        existing.main[normalizedKey] = value;
        updated++;
      } else {
        unchanged++;
      }
    } else {
      existing.main[normalizedKey] = value;
      added++;
    }
  }
}

// Sort main keys alphabetically
const sortedMain = {};
for (const k of Object.keys(existing.main).sort()) {
  sortedMain[k] = existing.main[k];
}
existing.main = sortedMain;

fs.writeFileSync(INFOS_PATH, JSON.stringify(existing, null, 2) + "\n", "utf8");

console.log(`✅ Merge complete: ${added} added, ${updated} updated, ${unchanged} unchanged`);
console.log(`   Total main entries: ${Object.keys(existing.main).length}`);

// Cleanup temp files
for (const inputFile of INPUT_FILES) {
    if (fs.existsSync(inputFile)) {
        fs.unlinkSync(inputFile);
    }
}
