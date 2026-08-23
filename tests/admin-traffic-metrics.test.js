const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const adminSource = fs.readFileSync(path.join(root, "admin/admin.js"), "utf8");
const usersSource = fs.readFileSync(path.join(root, "admin/users.js"), "utf8");

test("admin traffic averages use the latest 7, 15 and 30 daily unique counts", () => {
  const averageSource = adminSource.slice(
    adminSource.indexOf("function getAverageDailyUniqueVisitors"),
    adminSource.indexOf("function renderVisitStatsAverages"),
  );
  const context = vm.createContext({});
  vm.runInContext(
    `${averageSource}
globalThis.getAverageDailyUniqueVisitors = getAverageDailyUniqueVisitors;`,
    context,
  );
  const rows = Array.from({ length: 30 }, (_, index) => ({
    uniqueVisitors: index + 1,
  }));

  assert.equal(context.getAverageDailyUniqueVisitors(rows, 7), 27);
  assert.equal(context.getAverageDailyUniqueVisitors(rows, 15), 23);
  assert.equal(context.getAverageDailyUniqueVisitors(rows, 30), 15.5);
});

test("admin user relative dates count calendar days in Europe/Paris", () => {
  const formatterSource = usersSource.slice(
    usersSource.indexOf("const parisDayFormatter"),
    usersSource.indexOf("const rankOrder"),
  );
  const relativeDateSource = usersSource.slice(
    usersSource.indexOf("function formatDaysAgo"),
    usersSource.indexOf("function renderDateWithAge"),
  );
  const context = vm.createContext({ Date, Intl });
  vm.runInContext(
    `${formatterSource}
${relativeDateSource}
globalThis.formatDaysAgo = formatDaysAgo;`,
    context,
  );

  assert.equal(
    context.formatDaysAgo("2026-03-28T23:30:00Z", new Date("2026-03-30T00:30:00Z")),
    "Il y a 1 jour",
  );
  assert.equal(
    context.formatDaysAgo("2026-03-27T12:00:00Z", new Date("2026-03-30T12:00:00Z")),
    "Il y a 3 jours",
  );
});
