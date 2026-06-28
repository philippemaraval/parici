const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

test("Daily manifest uses diverse streets and rotates every arrondissement", () => {
  const output = path.join(os.tmpdir(), `parici-daily-${process.pid}.csv`);
  execFileSync(
    process.execPath,
    [
      path.join(ROOT, "scripts", "generate_daily_manifest.js"),
      "--from",
      "2026-06-28",
      "--days",
      "120",
      "--output",
      output,
    ],
    { stdio: "pipe" },
  );

  const [header, ...lines] = fs.readFileSync(output, "utf8").trim().split(/\r?\n/);
  fs.unlinkSync(output);
  assert.equal(header, "date,street_name,arrondissement,file_name,missing_image_street");

  const rows = lines.map((line) => {
    const cells = line.split(",");
    return { street: cells[1], arrondissement: cells[2] };
  });
  assert.equal(rows.length, 120);
  assert.equal(new Set(rows.map(({ street }) => street)).size, 120);
  assert.equal(new Set(rows.map(({ arrondissement }) => arrondissement)).size, 20);
  rows.slice(1).forEach((row, index) => {
    assert.notEqual(row.arrondissement, rows[index].arrondissement);
  });

  const rules = require("../data_rules");
  const previouslyRestrictedNames = new Set([
    ...rules.FAMOUS_STREET_NAMES,
    ...rules.MAIN_STREET_NAMES,
  ]);
  assert(rows.some(({ street }) => !previouslyRestrictedNames.has(street.toLowerCase())));
});
