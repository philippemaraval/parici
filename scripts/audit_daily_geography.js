#!/usr/bin/env node
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { parseCsv } = require("./check_player_content");
const { plan, streetPhotoView } = require("./enrich_collect_paris_photos");
const { axisDifference } = require("./lib/collect-street-view");
const root = path.resolve(__dirname, "..");
function auditDailyGeography({
  from = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()),
} = {}) {
  const audit = JSON.parse(
    fs.readFileSync(
      path.join(root, "data/daily_images/geography-audit-20261014.json"),
      "utf8",
    ),
  );
  const [headers, ...rows] = parseCsv(
    fs.readFileSync(
      path.join(root, "data/daily_images/manifest_next_30.csv"),
      "utf8",
    ),
  );
  const manifest = rows
    .map((values) => Object.fromEntries(headers.map((h, i) => [h, values[i]])))
    .filter((r) => r.date >= from);
  const jobs = new Map(
    plan({ allStreets: true, includePhotographed: true }).map((j) => [
      j.key,
      j,
    ]),
  );
  const receipts = new Map(audit.entries.map((r) => [r.date, r]));
  const exclusions = JSON.parse(
    fs.readFileSync(
      path.join(root, "data/collect_photo_exclusions_paris.json"),
      "utf8",
    ),
  );
  const forbidden = new Set(
    Object.values(exclusions)
      .flatMap((e) => e.images)
      .filter((image) => fs.existsSync(path.join(root, image)))
      .map((image) =>
        crypto
          .createHash("sha256")
          .update(fs.readFileSync(path.join(root, image)))
          .digest("hex"),
      ),
  );
  const errors = [];
  for (const target of manifest) {
    const entry = receipts.get(target.date),
      job = entry && jobs.get(entry.cardKey);
    if (!entry || !job) {
      errors.push(`${target.date}: contrôle géographique manquant`);
      continue;
    }
    if (
      entry.street !== target.street_name ||
      entry.image !== "/data/daily_images/" + target.file_name
    )
      errors.push(
        `${target.date}: contrôle attaché à une autre cible ou image`,
      );
    const bytes = fs.readFileSync(path.join(root, entry.image)),
      sha = crypto.createHash("sha256").update(bytes).digest("hex");
    if (sha !== entry.sha256 || forbidden.has(sha))
      errors.push(`${target.date}: image modifiée ou rejetée`);
    const view = streetPhotoView(entry.coordinate, job);
    if (!view || view.distanceMeters > 18)
      errors.push(`${target.date}: panorama hors géométrie`);
    if (
      view &&
      !view.surface &&
      Number.isFinite(view.heading) &&
      axisDifference(view.heading, entry.heading) > 30
    )
      errors.push(`${target.date}: cadrage hors axe`);
    if (
      !entry.panoId ||
      !entry.captureDate ||
      !entry.copyright ||
      !entry.visualReview ||
      !entry.reviewedAt
    )
      errors.push(`${target.date}: preuves incomplètes`);
  }
  if (errors.length) throw new Error(errors.join("\n"));
  return {
    from,
    targets: manifest.length,
    verified: manifest.length,
    through: manifest.at(-1)?.date || null,
  };
}
if (require.main === module) {
  try {
    console.log("Géographie Daily vérifiée :", auditDailyGeography());
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { auditDailyGeography };
