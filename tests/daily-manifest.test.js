const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

test("Daily manifest uses diverse streets and rotates through administrative quartiers", () => {
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
  assert.equal(new Set(rows.map(({ arrondissement }) => arrondissement)).size, 80);
  rows.forEach((row, index) => {
    const previousTwelve = rows
      .slice(Math.max(0, index - 12), index)
      .map(({ arrondissement }) => arrondissement);
    assert(!previousTwelve.includes(row.arrondissement));
  });

  const rules = require("../data_rules");
  const previouslyRestrictedNames = new Set([
    ...rules.FAMOUS_STREET_NAMES,
    ...rules.MAIN_STREET_NAMES,
  ]);
  assert(rows.some(({ street }) => !previouslyRestrictedNames.has(street.toLowerCase())));
});

test("Daily generation excludes Quai E even when an old street index contains it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parici-daily-exclusions-"));
  try {
    const index = path.join(dir, "index.json");
    const output = path.join(dir, "manifest.csv");
    const entries = Array.from({ length: 30 }, (_, i) => ({
      name: `Rue Test ${i}`, arrondissement: `Secteur ${i}`,
    }));
    entries.push({ name: "Quai E", arrondissement: "Quartier de la Gare" });
    fs.writeFileSync(index, JSON.stringify(entries));
    const args = [path.join(ROOT, "scripts/generate_daily_manifest.js"),
      "--from", "2027-01-01", "--days", "30", "--index", index, "--output", output];
    execFileSync(process.execPath, args, { stdio: "pipe" });
    const csv = fs.readFileSync(output, "utf8");
    assert.equal(csv.trim().split("\n").length, 31);
    assert.doesNotMatch(csv, /Quai E/);
    args[args.indexOf("--days") + 1] = "31";
    assert.throws(() => execFileSync(process.execPath, args, { stdio: "pipe" }), /Not enough unique streets: 30/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the server ignores excluded Daily entries even in a cached manifest", () => {
  const vm = require("node:vm");
  const { shouldKeepStreetForGame } = require("../street_filter");
  const source = fs.readFileSync(path.join(ROOT, "backend/server.js"), "utf8");
  const start = source.indexOf("function getDailyManifestEntryByDate(");
  const end = source.indexOf("\nfunction ", start + 1);
  const valid = { streetName: "Rue Bruneseau" };
  const entries = new Map([
    ["2027-01-03", { streetName: "Quai E" }],
    ["2027-04-17", valid],
  ]);
  const context = vm.createContext({ shouldKeepStreetForGame, loadDailyManifestByDate: () => entries });
  vm.runInContext(source.slice(start, end), context);
  assert.equal(context.getDailyManifestEntryByDate("2027-01-03"), null);
  assert.equal(context.getDailyManifestEntryByDate("2027-04-17"), valid);
  assert.equal(context.getDailyManifestEntryByDate("2027-01-04"), null);
});
