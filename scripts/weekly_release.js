#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const STATE_FILE = ".github/releases/state.json";
const PAGES = ["index.html", "regles.html", "versions.html"];
const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function parisDate(now) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function weekOf(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Date ISO attendue");
  const day = new Date(`${date}T12:00:00Z`);
  if (
    !Number.isFinite(day.getTime()) ||
    day.toISOString().slice(0, 10) !== date
  )
    throw new Error("Date invalide");
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}

function nextVersion(version, major) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Version invalide");
  const [generation, milestone, patch] = version.split(".").map(Number);
  return major
    ? `${generation}.${milestone + 1}.0`
    : `${generation}.${milestone}.${patch + 1}`;
}

function playerFile(file) {
  return /^(?:src\/|(?:index|collect|explorer|regles)\.html$|style\.css$|backend\/domains\/(?:collect|collect-social|explorer|profiles)\/)/.test(
    file,
  );
}

function trailer(message, key) {
  return [...message.matchAll(new RegExp(`^${key}:\\s*(.+)$`, "gmi"))].map(
    (m) => m[1].trim(),
  );
}

// Conservative fallback for commits without release trailers. Never publish raw
// commit messages: they may contain account names, internal details or English.
function summarize(commit) {
  const message = commit.message;
  const subject = message.split("\n")[0];
  const level = trailer(message, "Release-Level")[0]?.toLowerCase();
  if (level && !["major", "minor", "none"].includes(level))
    throw new Error(`Release-Level invalide : ${commit.sha}`);
  if (level === "none" || /^revert\b/i.test(subject)) return null;
  const notes = trailer(message, "Release-Note");
  const title = trailer(message, "Release-Title")[0];
  if (level === "major" && (!notes.length || !title))
    throw new Error(
      `Une avancée majeure exige Release-Note et Release-Title : ${commit.sha}`,
    );
  if (notes.length) return { notes, major: level === "major", title };
  if (!commit.files.some(playerFile)) return null;
  // Small fixes, data refreshes, editorial history and infrastructure are not releases.
  if (
    /^(?:fix|chore|test|docs|refactor|perf|sync|build|ci)(?:\b|\()/i.test(
      subject,
    ) ||
    /\b(?:admin|postgres|migration|deploy|version history|historique|aygalades|street.?view|viewpoint|photo(?:graph)?.*correction)\b/i.test(
      subject,
    )
  )
    return null;
  if (
    !/\b(?:feat|add|introduce|launch|enable|improve|polish|refine|ajout\w*|nouveau\w*|amélior\w*|enrich\w*|activ\w*|harmonis\w*)\b/i.test(
      subject,
    )
  )
    return null;
  const newMode =
    /\b(?:add|introduce|launch|ajout\w*|lanc\w*)\b.*\b(?:new (?:game )?mode|nouveau mode|mode de jeu)\b/i.test(
      subject,
    );
  const mappings = [
    [
      /\b(?:friend|social|échange|ami)s?\b/i,
      "Retrouvez de nouvelles possibilités pour jouer avec vos amis et échanger vos cartes.",
    ],
    [
      /\bfavori(?:te)?s?\b/i,
      "Retrouvez plus facilement vos cartes préférées grâce aux favoris.",
    ],
    [
      /\b(?:weekly challenge|défi hebdomadaire)\b/i,
      "Participez au défi hebdomadaire et comparez vos résultats aux autres joueurs.",
    ],
    [
      /\b(?:album)s?\b/i,
      "Organisez et parcourez votre collection avec de nouvelles possibilités pour les albums.",
    ],
    [
      /\b(?:avatar|badge|rank|rang|progression)s?\b/i,
      "Suivez votre progression et découvrez de nouvelles possibilités de personnalisation.",
    ],
    [
      /\b(?:referral|parrainage)\b/i,
      "Invitez vos proches et progressez grâce au parrainage.",
    ],
    [
      /\b(?:bus|rtm)\b/i,
      "Jouez avec les lignes de bus et repérez plus facilement leurs parcours sur la carte.",
    ],
    [
      /\b(?:navigation|layout|design|interface|charte)\b/i,
      "Profitez d’une interface plus lisible et d’une navigation plus simple entre les modes de jeu.",
    ],
    [
      /\bexplorer\b/i,
      "Découvrez les évolutions des parcours et de l’expérience de jeu Explorer.",
    ],
    [
      /\bdaily\b/i,
      "Retrouvez les nouveautés du défi quotidien et de la présentation de vos résultats.",
    ],
    [
      /\bcollect\b/i,
      "Découvrez les nouveautés du jeu Collect et de la présentation de votre collection.",
    ],
  ];
  const match = mappings.find(([pattern]) => pattern.test(subject));
  return {
    major: newMode,
    title: newMode ? "Un nouveau mode de jeu" : undefined,
    notes: [
      newMode
        ? "Un nouveau mode de jeu enrichit les façons de découvrir Paris."
        : match?.[1] ||
          "L’expérience de jeu évolue pour rendre vos parties plus agréables.",
    ],
  };
}

function readCommits(root, from, head) {
  const netFiles = new Set(
    git(root, "diff", "--name-only", from, head).split("\n"),
  );
  const hashes = git(
    root,
    "log",
    "--no-merges",
    "--reverse",
    "--format=%H",
    `${from}..${head}`,
  )
    .split("\n")
    .filter(Boolean);
  const commits = hashes.map((sha) => ({
    sha,
    message: git(root, "show", "-s", "--format=%B", sha),
    files: git(root, "diff-tree", "--no-commit-id", "--name-only", "-r", sha)
      .split("\n")
      .filter((file) => netFiles.has(file)),
  }));
  const reverted = new Set(
    commits.flatMap((commit) =>
      [...commit.message.matchAll(/This reverts commit ([a-f0-9]{40})/g)].map(
        (m) => m[1],
      ),
    ),
  );
  return commits.filter(
    (commit) => !reverted.has(commit.sha) && commit.files.length,
  );
}

function updateHistory(html, version, date, notes, major, title) {
  const family = version.split(".").slice(0, 2).join(".");
  const familyId = family.replaceAll(".", "-");
  const id = version.replaceAll(".", "-");
  if (html.includes(`id="version-${id}"`))
    throw new Error("Cette version existe déjà");
  const displayDate = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
  const number = major ? `<strong>V${version}</strong>` : `V${version}`;
  const entry = `\n      <li class="version-entry${major ? " version-entry--major" : ""}" id="version-${id}">\n        <article aria-labelledby="heading-${version}">\n          <header class="version-heading"><h3 id="heading-${version}">${number}</h3><p>${displayDate}</p></header>\n          <ul>${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>\n        </article>\n      </li>`;
  if (major) {
    const section = `    <section class="version-family" id="versions-${familyId}" aria-labelledby="family-${family}">\n      <h2 id="family-${family}"><strong>V${version} — ${escapeHtml(title)}</strong></h2>\n      <ol class="version-list" reversed>${entry}\n      </ol>\n    </section>\n`;
    const marker = '    <section class="version-family"';
    if (!html.includes(marker)) throw new Error("Historique introuvable");
    html = html.replace(marker, () => section + marker);
    html = html.replace(
      /(<nav class="versions-index"[^>]*>)/,
      `$1<a href="#versions-${familyId}">V${family}</a>`,
    );
  } else {
    const marker = new RegExp(
      `(<section class="version-family" id="versions-${familyId}"[^>]*>[\\s\\S]*?<ol class="version-list" reversed>)`,
    );
    if (!marker.test(html)) throw new Error("Famille de version introuvable");
    html = html.replace(marker, (_match, opening) => opening + entry);
  }
  const updated = /<p class="versions-updated">[^<]*<\/p>/;
  if (!updated.test(html)) throw new Error("Date de l’historique introuvable");
  return html.replace(
    updated,
    `<p class="versions-updated">Mis à jour le ${displayDate} · Dernière version : V${version}</p>`,
  );
}

function release({
  root = path.resolve(__dirname, ".."),
  now = new Date(),
  dryRun = false,
} = {}) {
  if (git(root, "branch", "--show-current") !== "main")
    throw new Error("La publication exige la branche main");
  const date = parisDate(now);
  const week = weekOf(date);
  if (date !== week)
    return {
      changed: false,
      reason: "La publication a lieu le lundi (Europe/Paris).",
    };
  const state = JSON.parse(
    fs.readFileSync(path.join(root, STATE_FILE), "utf8"),
  );
  if (state.lastPublishedWeek && state.lastPublishedWeek >= week)
    return { changed: false, reason: "Cette semaine est déjà publiée." };
  if (!/^[a-f0-9]{40}$/.test(state.lastCommit))
    throw new Error("Curseur Git invalide");
  if (!/^\d+\.\d+\.\d+$/.test(state.version))
    throw new Error("Version invalide");
  git(root, "merge-base", "--is-ancestor", state.lastCommit, "HEAD");
  const head = git(root, "rev-parse", "HEAD");
  const changes = readCommits(root, state.lastCommit, head)
    .map(summarize)
    .filter(Boolean);
  const notes = [...new Set(changes.flatMap((change) => change.notes))];
  if (!notes.length)
    return {
      changed: false,
      reason: "Aucune nouveauté pour les joueurs à annoncer.",
    };
  const significant = changes.findLast((change) => change.major);
  const version = nextVersion(state.version, Boolean(significant));
  // Prepare all outputs before writing anything: an invalid page cannot leave
  // the badges or release cursor partially advanced.
  const outputs = new Map();
  for (const page of PAGES) {
    let html = fs.readFileSync(path.join(root, page), "utf8");
    const badge =
      /(<div\b[^>]*class="[^"]*\b(?:site-header__version|app-version-pill)\b[^"]*"[^>]*>\s*)V\d+\.\d+\.\d+/g;
    const matches = [...html.matchAll(badge)];
    if (matches.length !== 1 || !matches[0][0].endsWith(`V${state.version}`))
      throw new Error(`Pastille incohérente : ${page}`);
    html = html.replace(badge, (_match, opening) => opening + `V${version}`);
    if (page === "versions.html")
      html = updateHistory(
        html,
        version,
        date,
        notes,
        Boolean(significant),
        significant?.title,
      );
    outputs.set(page, html);
  }
  outputs.set(
    STATE_FILE,
    JSON.stringify(
      { version, lastCommit: head, lastPublishedWeek: week },
      null,
      2,
    ) + "\n",
  );
  if (!dryRun)
    for (const [file, content] of outputs)
      fs.writeFileSync(path.join(root, file), content);
  return {
    changed: true,
    version,
    major: Boolean(significant),
    notes,
    files: [...outputs.keys()],
  };
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.some((arg) => arg !== "--dry-run"))
      throw new Error("Seule l’option --dry-run est acceptée");
    const result = release({ dryRun: args.includes("--dry-run") });
    console.log(JSON.stringify(result, null, 2));
    if (process.env.GITHUB_OUTPUT)
      fs.appendFileSync(
        process.env.GITHUB_OUTPUT,
        `changed=${result.changed}\nversion=${result.version || ""}\n`,
      );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = {
  parisDate,
  weekOf,
  nextVersion,
  summarize,
  updateHistory,
  release,
};
