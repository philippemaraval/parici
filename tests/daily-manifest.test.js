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

test("an existing Daily target is preserved when the manifest or filter changes", async () => {
  const vm = require("node:vm");
  const source = fs.readFileSync(path.join(ROOT, "backend/server.js"), "utf8");
  const start = source.indexOf("async function ensureDailyTarget()");
  const end = source.indexOf("\nasync function getTargetGeometry", start);
  for (const street_name of ["Passage F/7", "Passage du Grand-Cerf"]) {
    const target = { street_name, coordinates_json: "[2.35,48.86]" };
    let writes = 0;
    const context = vm.createContext({
      getDailyDateKey: () => "2026-10-23",
      db: { getDailyTarget: async () => target, createDailyTargetIfAbsent: async () => { writes++; } },
      getDailyManifestEntryByDate: () => { throw Error("An existing publication must not read a revised manifest"); },
    });
    vm.runInContext(source.slice(start,end), context);
    assert.equal(await context.ensureDailyTarget(), "2026-10-23");
    assert.equal(writes, 0);
  }
});

test("reading a Daily result preserves snapshots and resolves missing geometry without a database write", async () => {
  const vm = require("node:vm");
  const source = fs.readFileSync(path.join(ROOT, "backend/server.js"), "utf8");
  const normalization = source.slice(source.indexOf("function shouldRefreshStoredDailyGeometry("), source.indexOf("async function refreshDailyTargetsFromCurrentStreetData("));
  const reader = source.slice(source.indexOf("async function getTargetGeometry("), source.indexOf("\napp.get('/api/daily/health'"));
  const stored = { type: "LineString", coordinates: [[2.35, 48.86], [2.36, 48.87]] };
  const fallback = { type: "LineString", coordinates: [[2.37, 48.86], [2.38, 48.87]] };
  const context = vm.createContext({
    parseGeometryJson: (value) => value ? JSON.parse(value) : null,
    extractStreetGeometry: () => fallback,
    db: new Proxy({}, { get() { throw Error("A result reader must not access a database writer"); } }),
  });
  vm.runInContext(normalization + reader, context);
  assert.equal(await context.getTargetGeometry({ geometry_json: JSON.stringify(stored) }), JSON.stringify(stored));
  for (const geometry of [null, { type: "FeatureCollection", features: [] }]) {
    assert.equal(await context.getTargetGeometry({ geometry_json: geometry && JSON.stringify(geometry) }), JSON.stringify(fallback));
  }
});
