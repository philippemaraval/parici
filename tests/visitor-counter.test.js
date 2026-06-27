const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

async function loadSiteShell(storage, generatedIds) {
  const requests = [];
  const script = new vm.Script(
    fs.readFileSync(path.join(ROOT, "src/public/js/site-shell.js"), "utf8"),
  );
  const visitorCounter = { textContent: "" };
  const window = {
    crypto: {
      randomUUID() {
        return generatedIds.shift();
      },
    },
    setInterval() {
      return 1;
    },
    clearInterval() {},
  };

  script.runInContext(vm.createContext({
    console,
    document: {
      querySelector(selector) {
        return selector === ".site-footer__visitors" ? visitorCounter : null;
      },
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        async json() {
          return { visits: 42 };
        },
      };
    },
    Intl,
    localStorage: storage,
    location: { hostname: "camino.example", protocol: "https:" },
    navigator: {},
    window,
  }));

  await new Promise((resolve) => setImmediate(resolve));
  return JSON.parse(requests[0].options.body);
}

test("site pages reuse one active visit and create a new one after inactivity", async () => {
  const storage = createStorage();
  const ids = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
  ];

  const firstPage = await loadSiteShell(storage, ids);
  const secondPage = await loadSiteShell(storage, ids);
  assert.equal(secondPage.visitId, firstPage.visitId);
  assert.equal(secondPage.visitorId, firstPage.visitorId);

  const storedVisit = JSON.parse(storage.getItem("camino_visit_session"));
  storage.setItem(
    "camino_visit_session",
    JSON.stringify({ ...storedVisit, lastSeenAt: Date.now() - 31 * 60 * 1000 }),
  );

  const laterPage = await loadSiteShell(storage, ids);
  assert.notEqual(laterPage.visitId, firstPage.visitId);
  assert.equal(laterPage.visitorId, firstPage.visitorId);
});

test("backend counts each visit session exactly once", async () => {
  const originalLoad = Module._load;
  const sessions = new Set();
  const visitors = new Map();
  let totalVisits = 0;

  const client = {
    release() {},
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      if (normalized === "BEGIN" || normalized === "COMMIT" || normalized === "ROLLBACK") {
        return { rowCount: 0, rows: [] };
      }
      if (normalized.startsWith("INSERT INTO visitor_sessions")) {
        const isNew = !sessions.has(params[0]);
        sessions.add(params[0]);
        return { rowCount: isNew ? 1 : 0, rows: isNew ? [{ session_hash: params[0] }] : [] };
      }
      if (normalized.startsWith("INSERT INTO visitors_unique")) {
        const isNew = !visitors.has(params[0]);
        if (isNew) visitors.set(params[0], 1);
        return { rowCount: isNew ? 1 : 0, rows: isNew ? [{ visitor_hash: params[0] }] : [] };
      }
      if (normalized.startsWith("UPDATE visitors_unique")) {
        visitors.set(params[0], visitors.get(params[0]) + params[1]);
        return { rowCount: 1, rows: [] };
      }
      if (normalized.startsWith("INSERT INTO visitor_daily_uniques")) {
        return { rowCount: 1, rows: [{ visitor_hash: params[0] }] };
      }
      if (normalized.startsWith("INSERT INTO visitor_daily_stats")) {
        return { rowCount: 1, rows: [] };
      }
      if (normalized.startsWith("UPDATE visitor_sessions")) {
        return { rowCount: 1, rows: [] };
      }
      if (
        normalized.startsWith("INSERT INTO visitors_counter") &&
        normalized.includes("SELECT 1")
      ) {
        return { rowCount: 1, rows: [{ total_visits: totalVisits }] };
      }
      if (normalized.startsWith("INSERT INTO visitors_counter")) {
        totalVisits += 1;
        return { rowCount: 1, rows: [{ total_visits: totalVisits }] };
      }
      throw new Error(`Unexpected SQL in test: ${normalized}`);
    },
  };

  Module._load = function mockLoad(request, parent, isMain) {
    if (request === "pg") {
      return { Pool: class Pool { connect() { return client; } } };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const databasePath = path.join(ROOT, "backend/database.js");
    delete require.cache[databasePath];
    const database = require(databasePath);

    assert.equal(await database.recordVisitHit("visitor-a", "visit-1"), 1);
    assert.equal(await database.recordVisitHit("visitor-a", "visit-1"), 1);
    assert.equal(await database.recordVisitHit("visitor-a", "visit-2"), 2);
    assert.equal(visitors.get("visitor-a"), 2);
  } finally {
    Module._load = originalLoad;
  }
});
