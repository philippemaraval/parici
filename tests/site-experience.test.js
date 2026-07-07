const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("every public Parici page exposes French metadata and app icons", () => {
  for (const page of ["index.html", "regles.html", "arbre-rangs.html", "reset-password.html"]) {
    const source = read(page);
    assert.match(source, /<html lang="fr">/);
    assert.match(source, /<meta name="description"/);
    assert.match(source, /apple-touch-icon|camino-paris-favicon/);
  }
});

test("Parici public shell does not expose the Camino Explorer mode", () => {
  assert.equal(fs.existsSync(path.join(ROOT, "explorer.html")), false);

  for (const page of ["index.html", "regles.html", "arbre-rangs.html", "reset-password.html"]) {
    assert.doesNotMatch(read(page), /explorer\.html|admin\/explorer|Explorer/);
  }

  assert.doesNotMatch(read("style.css"), /explorer-mode-link|mobile-mode-card--explorer/);
  assert.doesNotMatch(read("src/public/css/site-shell.css"), /is-active--explorer/);
  assert.doesNotMatch(read("sw.js"), /camino-explorer-sync|CAMINO_EXPLORER_SYNC/);
  assert.doesNotMatch(read("backend/database.js"), /explorer_riddles|explorer_user_progress|explorer_leaderboard/);
});

test("the game starts with the established satellite background", () => {
  const source = read("src/app.js");

  assert.match(source, /World_Imagery\/MapServer\/tile/);
  assert.doesNotMatch(source, /camino_map_base/);
  assert.doesNotMatch(source, /const lightMapLayer/);
});

test("startup loads the local game immediately and bounds remote waits", () => {
  const app = read("src/app.js");
  const apiClient = read("src/api-client.js");
  const serviceWorker = read("sw.js");

  assert.match(app, /scheduleAfterStartup\(\(\) => \{\s*loadStreets\(\)/);
  assert.match(app, /warmBackendConnection\(\);\s*loadStreetInfos\(\)/);
  assert.match(apiClient, /export async function fetchWithTimeout/);
  assert.match(apiClient, /export async function fetchWithStartupRetry/);
  assert.match(serviceWorker, /NAVIGATION_NETWORK_TIMEOUT_MS = 3500/);
  assert.match(serviceWorker, /main\.js\?v=20260707-v040/);
});

test("Daily reminders persist locally and have an external server wakeup", () => {
  const app = read("src/app.js");
  const workflow = read(".github/workflows/daily-reminder-wakeup.yml");

  assert.match(app, /DAILY_REMINDER_INTENT_PREFIX/);
  assert.match(app, /ensureCurrentPushSubscription/);
  assert.match(app, /Rappel quotidien actif et vérifié/);
  assert.match(workflow, /cron: "0 8,9 \* \* \*"/);
  assert.match(workflow, /api\/ready/);
});

test("rules mirror the actual Daily and Parici rank behavior", () => {
  const rules = read("regles.html");

  assert.match(rules, /premier appui place le point de confirmation/);
  assert.match(rules, /milieux géométriques des deux voies complètes/);
  assert.match(rules, /Rang global: valider les 6 zones globales/);
  assert.match(rules, /Préfet de Paris/);
  assert.match(rules, /dans au moins un mode classé/);
  assert.doesNotMatch(rules, /<p>\s*<p>/);
  assert.doesNotMatch(rules, /Explorer/);
});

test("page headings share one rhythm and expose version 0.4.0", () => {
  const index = read("index.html");
  const rules = read("regles.html");
  const styles = read("style.css");

  [index, rules].forEach((source) => {
    assert.match(source, /V0\.4\.0/);
    assert.match(source, /20260707-v040/);
  });
  assert.match(styles, /html\[data-mobile-view="home"\] \.mobile-home[\s\S]*padding: 0 0 8px/);
  assert.match(styles, /#sidebar-content > \.user-panel \{\s*margin-top: 0/);
  assert.match(styles, /\.daily-reminder-card \{[\s\S]*position: absolute;[\s\S]*right: 0/);
});
