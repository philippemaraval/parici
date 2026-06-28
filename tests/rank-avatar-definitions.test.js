const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

function loadVilleRankAvatarDefinitions() {
  const source = fs
    .readFileSync(path.join(ROOT, "src/rank-avatar-definitions.js"), "utf8")
    .replace("export const VILLE_RANK_AVATAR_DEFINITIONS", "const VILLE_RANK_AVATAR_DEFINITIONS");
  const context = vm.createContext({});
  vm.runInContext(`${source}
    globalThis.VILLE_RANK_AVATAR_DEFINITIONS = JSON.stringify(VILLE_RANK_AVATAR_DEFINITIONS);
  `, context);
  return JSON.parse(context.VILLE_RANK_AVATAR_DEFINITIONS);
}

test("Paname entier rank avatars include Astronaute and stay shared by badges and avatar selector", () => {
  const definitions = loadVilleRankAvatarDefinitions();
  assert.deepEqual(
    definitions.map(({ name, emoji, rankLetter }) => ({ name, emoji, rankLetter })),
    [
      { name: "Astronaute", emoji: "🚀", rankLetter: "M" },
      { name: "Étoile", emoji: "⭐️", rankLetter: "H" },
      { name: "Extraterrestre", emoji: "🛸", rankLetter: "V" },
      { name: "L'Ovni", emoji: "👽", rankLetter: "MV" },
    ],
  );

  const leaderboardSource = fs.readFileSync(path.join(ROOT, "src/leaderboard.js"), "utf8");
  const profileSource = fs.readFileSync(path.join(ROOT, "src/profile-runtime.js"), "utf8");

  assert.match(leaderboardSource, /VILLE_RANK_AVATAR_DEFINITIONS\.map/);
  assert.match(profileSource, /VILLE_RANK_AVATAR_DEFINITIONS\.map/);
});

function loadRenderAvatarGridRuntime(document) {
  const source = fs
    .readFileSync(path.join(ROOT, "src/profile-runtime.js"), "utf8")
    .replace(/^import .*;\n\n/, "")
    .replace(/export const /g, "const ")
    .replace(/export function /g, "function ");
  const context = vm.createContext({ console, document });
  vm.runInContext(`${source}
    globalThis.renderAvatarGridRuntime = renderAvatarGridRuntime;
  `, context);
  return context.renderAvatarGridRuntime;
}

test("avatar unlock checks use loaded profile stats, not the auth-only current user", () => {
  const grid = {
    innerHTML: "previous",
    children: [],
    appendChild(item) {
      this.children.push(item);
    },
  };
  const document = {
    getElementById(id) {
      return id === "avatar-grid" ? grid : null;
    },
    createElement(tagName) {
      return {
        tagName,
        className: "",
        classList: {
          values: new Set(),
          add(value) {
            this.values.add(value);
          },
        },
        setAttribute(name, value) {
          this[name] = value;
        },
        addEventListener() {},
      };
    },
  };

  const renderAvatarGridRuntime = loadRenderAvatarGridRuntime(document);
  renderAvatarGridRuntime({
    currentAvatar: "👤",
    globalRankLevel: 0,
    avatarUnlocks: [
      {
        emoji: "🚀",
        name: "Astronaute",
        desc: "Atteindre Titi Parisien sur Paname entier",
        check: (stats) => stats?.modes?.some((mode) => mode.mode === "ville"),
      },
    ],
    titleNames: ["Préfet", "Vrai", "Habitué", "Titi", "Touriste"],
    unlockStats: { modes: [{ mode: "ville" }] },
    currentUser: { token: "token", username: "MGM" },
    getGlobalRankLevelForTitleIndex: () => 0,
    apiUrl: "",
    saveCurrentUserToStorage() {},
    updateUserUI() {},
    showMessage() {},
  });

  assert.equal(grid.children.length, 1);
  assert.equal(grid.children[0].textContent, "🚀");
  assert.equal(grid.children[0].classList.values.has("locked"), false);
});

function loadLeaderboardRankHelpers() {
  const source = fs
    .readFileSync(path.join(ROOT, "src/leaderboard.js"), "utf8")
    .replace(/^import .*;\n/gm, "")
    .replace(/export const /g, "const ")
    .replace(/export function /g, "function ");
  const context = vm.createContext({ console });
  vm.runInContext(`const VILLE_RANK_AVATAR_DEFINITIONS = [];
    ${source}
    globalThis.hasReachedVilleRank = hasReachedVilleRank;
    globalThis.hasReachedVilleRankInAnyMode = hasReachedVilleRankInAnyMode;
  `, context);
  return {
    hasReachedVilleRank: context.hasReachedVilleRank,
    hasReachedVilleRankInAnyMode: context.hasReachedVilleRankInAnyMode,
  };
}

test("Astronaute avatar unlocks from one Paname entier Titi Parisien score", () => {
  const { hasReachedVilleRank, hasReachedVilleRankInAnyMode } = loadLeaderboardRankHelpers();
  const profile = {
    modes: [
      {
        mode: "ville",
        game_type: "classique",
        high_score: 35,
        best_items_correct: 0,
        best_items_total: 0,
      },
    ],
  };

  assert.equal(hasReachedVilleRankInAnyMode(profile, "M"), true);
  assert.equal(hasReachedVilleRank(profile, "M"), false);
});
