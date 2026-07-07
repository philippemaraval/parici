const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const serverSource = fs.readFileSync(path.join(root, "backend/server.js"), "utf8");
const rankSource = serverSource.slice(
  serverSource.indexOf("const ADMIN_RANK_THRESHOLDS"),
  serverSource.indexOf("const SCORE_MODE_ALIASES"),
);
const context = vm.createContext({});
vm.runInContext(`${rankSource}
  globalThis.getAdminRankThresholds = getAdminRankThresholds;
  globalThis.getProfileRankForAdmin = getProfileRankForAdmin;
`, context);

const gameTypes = ["classique", "marathon", "chrono"];
const zones = [
  "rues-celebres",
  "rues-principales",
  "arrondissement",
  "monuments",
  "arrondissements-ville",
  "lignes-transports-idf",
];

function buildCompleteProfile(level) {
  return gameTypes.flatMap((gameType) =>
    zones.map((mode) => {
      const entry = {
        mode,
        game_type: gameType,
        best_items_total: mode === "arrondissement" && gameType === "marathon" ? 55 : 200,
      };
      const thresholds = context.getAdminRankThresholds(entry);
      const score = thresholds[level - 1];
      return gameType === "classique"
        ? { ...entry, high_score: score }
        : { ...entry, best_items_correct: score };
    }),
  );
}

test("admin user rank uses the complete Parici profile rank, not the best individual score", () => {
  const modes = buildCompleteProfile(3);
  modes[0].high_score = 999;

  assert.equal(context.getProfileRankForAdmin(modes), "Vrai Parigot");
});

test("admin user rank reaches Prefet only when every Parici profile combination reaches it", () => {
  assert.equal(context.getProfileRankForAdmin(buildCompleteProfile(4)), "Préfet de Paris");
});

test("admin user rank requires the Paris transport mode for global ranks", () => {
  const modes = buildCompleteProfile(4).filter((entry) => entry.mode !== "lignes-transports-idf");

  assert.equal(context.getProfileRankForAdmin(modes), "Touriste");
});
