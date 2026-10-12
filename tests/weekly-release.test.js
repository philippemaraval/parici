const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  parisDate,
  weekOf,
  nextVersion,
  summarize,
  release,
} = require("../scripts/weekly_release");
const root = path.resolve(__dirname, "..");
const pages = ["index.html", "regles.html", "versions.html"];
const monday = new Date("2026-10-19T07:17:00Z");

function repository(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "camino-release-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  git("init", "--initial-branch=main");
  git("config", "user.email", "release-test@example.test");
  git("config", "user.name", "Release test");
  for (const page of pages) {
    const source =
      page === "versions.html"
        ? path.join(root, "tests/fixtures/version-history.html")
        : path.join(root, page);
    const html = fs
      .readFileSync(source, "utf8")
      .replace(
        /(<div\b[^>]*class="[^"]*(?:site-header__version|app-version-pill)[^"]*"[^>]*>\s*)V\d+\.\d+\.\d+/g,
        (_match, opening) => opening + "V0.5.1",
      );
    fs.writeFileSync(path.join(dir, page), html);
  }
  fs.mkdirSync(path.join(dir, ".github/releases"), { recursive: true });
  git("add", ...pages);
  git("commit", "-m", "Initial player history");
  const baseline = git("rev-parse", "HEAD");
  const initial = {
    version: "0.5.1",
    lastCommit: baseline,
    lastPublishedWeek: "2026-10-12",
  };
  fs.writeFileSync(
    path.join(dir, ".github/releases/state.json"),
    JSON.stringify(initial),
  );
  git("add", ".github/releases/state.json");
  git("commit", "-m", "chore: initialize release cursor");
  let serial = 0;
  function commit(message, file = "src/public/js/collect.js") {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), `// revision ${++serial}\n`);
    git("add", file);
    git("commit", "-m", message);
    return git("rev-parse", "HEAD");
  }
  return { dir, git, commit, initial };
}

function snapshot(dir) {
  return [...pages, ".github/releases/state.json"].map((file) =>
    fs.readFileSync(path.join(dir, file), "utf8"),
  );
}

test("Paris dates and Monday weeks follow winter and summer time", () => {
  assert.equal(parisDate(new Date("2026-10-18T22:30:00Z")), "2026-10-19");
  assert.equal(parisDate(new Date("2026-12-06T23:30:00Z")), "2026-12-07");
  assert.equal(weekOf("2026-10-25"), "2026-10-19");
  assert.throws(() => weekOf("2026-02-30"), /invalide/);
});

test("ordinary advances bump the patch; major player milestones bump the next family", () => {
  assert.equal(nextVersion("0.5.1", false), "0.5.2");
  assert.equal(nextVersion("0.5.9", false), "0.5.10");
  assert.equal(nextVersion("0.5.9", true), "0.6.0");
  assert.equal(nextVersion("1.2.3", true), "1.3.0");
});

test("only durable player improvements qualify for the fallback", () => {
  const classify = (message, files = ["src/public/js/collect.js"]) =>
    summarize({ sha: "test", message, files });
  for (const message of [
    "fix(daily): pin Aygalades image",
    "sync: update street data from OSM",
    "refactor: improve Collect",
    "Add Collect admin controls",
  ]) {
    assert.equal(classify(message), null);
  }
  assert.equal(classify("Add leaderboard controls", ["admin/users.js"]), null);
  assert.equal(classify("Add a new mode to Parici").major, true);
  assert.match(classify("Add Collect favorites").notes[0], /favoris/);
  assert.equal(classify("Add Collect friends\n\nRelease-Level: none"), null);
  assert.equal(classify("feat!: database refactor").major, false);
  assert.throws(
    () => classify("Add new game\n\nRelease-Level: major"),
    /exige/,
  );
  assert.throws(
    () => classify("Add new game\n\nRelease-Level: invalid"),
    /invalide/,
  );
});

test("ordinary release updates all real page badges, preserves history and is idempotent", (t) => {
  const { dir, commit, git } = repository(t);
  commit(
    "feat(collect): add favorites\n\nRelease-Note: Retrouvez vos cartes préférées grâce aux favoris.\nRelease-Level: minor",
  );
  commit(
    "Improve favorites\n\nRelease-Note: Retrouvez vos cartes préférées grâce aux favoris.",
  );
  const head = git("rev-parse", "HEAD");
  const result = release({ root: dir, now: monday });
  assert.equal(result.version, "0.5.2");
  assert.equal(result.notes.length, 1);
  for (const page of pages) {
    const html = fs.readFileSync(path.join(dir, page), "utf8");
    assert.match(
      html,
      /class="[^"]*(?:site-header__version|app-version-pill)[^"]*"[^>]*>\s*V0\.5\.2/,
    );
  }
  const history = fs.readFileSync(path.join(dir, "versions.html"), "utf8");
  assert.match(history, /id="version-0-5-2"/);
  assert.match(history, /id="version-0-5-1"/);
  assert.match(
    history,
    /Mis à jour le 19 octobre 2026 · Dernière version : V0.5.2/,
  );
  assert.equal(history.match(/Retrouvez vos cartes préférées/g).length, 1);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(dir, ".github/releases/state.json"))),
    { version: "0.5.2", lastCommit: head, lastPublishedWeek: "2026-10-19" },
  );
  const after = snapshot(dir);
  assert.equal(release({ root: dir, now: monday }).changed, false);
  assert.deepEqual(snapshot(dir), after);
  commit("Add more features\n\nRelease-Note: Découvrez de nouveaux albums.");
  assert.equal(release({ root: dir, now: monday }).changed, false);
});

test("a major release creates a bold family, escapes notes and adds navigation", (t) => {
  const { dir, commit } = repository(t);
  commit(
    "Add a new game\n\nRelease-Level: major\nRelease-Title: Nouveau mode <Paris> $&\nRelease-Note: Découvrez <Paris> & ses rues.",
  );
  const result = release({ root: dir, now: monday });
  assert.equal(result.version, "0.6.0");
  const html = fs.readFileSync(path.join(dir, "versions.html"), "utf8");
  assert.match(
    html,
    /<strong>V0\.6\.0 — Nouveau mode &lt;Paris&gt; \$&amp;<\/strong>/,
  );
  assert.match(html, /<strong>V0\.6\.0<\/strong>/);
  assert.match(html, /href="#versions-0-6"/);
  assert.match(html, /Découvrez &lt;Paris&gt; &amp; ses rues/);
  assert(html.indexOf('id="versions-0-6"') < html.indexOf('id="versions-0-5"'));
});

test("empty weeks and weekdays do not bump or change files", (t) => {
  const { dir, commit } = repository(t);
  commit("fix: correct one Daily photo");
  commit("Add new admin dashboard", "admin/users.js");
  const before = snapshot(dir);
  assert.equal(release({ root: dir, now: monday }).changed, false);
  assert.deepEqual(snapshot(dir), before);
  commit("Add Collect feature\n\nRelease-Note: Organisez votre collection.");
  assert.equal(
    release({ root: dir, now: new Date("2026-10-20T10:00:00Z") }).changed,
    false,
  );
});

test("dry run announces a release without writing it", (t) => {
  const { dir, commit } = repository(t);
  commit("Add Collect favorites");
  const before = snapshot(dir);
  assert.equal(
    release({ root: dir, now: monday, dryRun: true }).version,
    "0.5.2",
  );
  assert.deepEqual(snapshot(dir), before);
});

test("bad badges fail before any file or cursor changes", (t) => {
  const { dir, commit } = repository(t);
  commit("Add Collect favorites");
  const page = path.join(dir, "versions.html");
  fs.writeFileSync(
    page,
    fs
      .readFileSync(page, "utf8")
      .replace(
        'class="site-header__version">V0.5.1',
        'class="site-header__version">V0.9.0',
      ),
  );
  const before = snapshot(dir);
  assert.throws(
    () => release({ root: dir, now: monday }),
    /Pastille incohérente/,
  );
  assert.deepEqual(snapshot(dir), before);
});

test("reverted features are not announced", (t) => {
  const { dir, commit, git } = repository(t);
  const feature = commit("Add Collect favorites");
  git("revert", "--no-edit", feature);
  assert.equal(release({ root: dir, now: monday }).changed, false);
});

test("the first run after a quiet week carries forward unreleased advances", (t) => {
  const { dir, commit, git } = repository(t);
  commit("Add Collect favorites");
  release({ root: dir, now: monday });
  git("add", ...pages, ".github/releases/state.json");
  git("commit", "-m", "chore(release): publish V0.5.2");
  assert.equal(
    release({ root: dir, now: new Date("2026-10-26T08:17:00Z") }).changed,
    false,
  );
  commit(
    "Add personal albums\n\nRelease-Note: Retrouvez vos albums personnels.",
  );
  const result = release({ root: dir, now: new Date("2026-11-02T08:17:00Z") });
  assert.equal(result.version, "0.5.3");
  assert.deepEqual(result.notes, ["Retrouvez vos albums personnels."]);
});
