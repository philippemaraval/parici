#!/usr/bin/env node
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { parseCsv } = require("./check_player_content");
const { plan, streetPhotoView } = require("./enrich_collect_paris_photos");
const { axisDifference } = require("./lib/collect-street-view");
const root = path.resolve(__dirname, "..");
function extendCalendar(through = "2027-12-31") {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(through) ||
    new Date(through + "T12:00:00Z").toISOString().slice(0, 10) !== through
  )
    throw Error("Invalid calendar end date");
  const file = path.join(root, "data/daily_images/manifest_next_30.csv");
  const original = fs.readFileSync(file, "utf8"),
    [headers, ...rows] = parseCsv(original);
  const manifest = rows.map((row) =>
    Object.fromEntries(headers.map((h, i) => [h, row[i]])),
  );
  for (let i = 1; i < manifest.length; i++) {
    const next = new Date(manifest[i - 1].date + "T12:00:00Z");
    next.setUTCDate(next.getUTCDate() + 1);
    if (next.toISOString().slice(0, 10) !== manifest[i].date)
      throw Error("Existing calendar is not continuous");
  }
  const last = manifest.at(-1).date;
  if (through <= last) return { added: 0, through: last };
  const photos = JSON.parse(
    fs.readFileSync(path.join(root, "data/collect_photos_paris.json")),
  );
  const auditFile = path.join(
    root,
    "data/daily_images/geography-audit-20261014.json",
  );
  const audit = JSON.parse(fs.readFileSync(auditFile));
  const jobs = plan({ allStreets: true, includePhotographed: true });
  const used = new Set(manifest.map((r) => r.street_name));
  const byDistrict = new Map();
  const index = JSON.parse(
    fs.readFileSync(path.join(root, "backend/data/streets_index.json")),
  );
  const resolveLocation =
    require("../backend/domains/game-integrity/daily-location").createDailyLocationResolver(
      JSON.parse(
        fs.readFileSync(path.join(root, "data/paris_quartiers.geojson")),
      ),
    );
  const catalog = JSON.parse(
    fs.readFileSync(path.join(root, "data/collect_paris_catalog.json")),
  ).records;
  const cards = new Map(
    catalog.map((c) => [c.family + ":" + c.source_entity_id, c]),
  );
  for (const job of jobs) {
    const photo = photos[job.key],
      proof = photo?.verification,
      card = cards.get(job.key);
    if (
      job.family !== "street" ||
      used.has(job.name) ||
      !proof?.panoId ||
      !proof.reviewedAt ||
      !proof.evidence ||
      !proof.sha256 ||
      !proof.copyright
    )
      continue;
    const view = streetPhotoView(proof.coordinate, job);
    if (
      !view ||
      view.distanceMeters > 18 ||
      (!view.surface && axisDifference(view.heading, proof.heading) > 30)
    )
      continue;
    const bytes = fs.readFileSync(path.join(root, photo.image));
    if (
      crypto.createHash("sha256").update(bytes).digest("hex") !== proof.sha256
    )
      continue;
    const district = card.arrondissement
      ? `${card.arrondissement}${card.arrondissement === 1 ? "er" : "e"} arrondissement`
      : "";
    const street =
      index.find((s) => s.name === job.name) ||
      index.find((s) => s.osmName === job.name);
    const location = resolveLocation(district, street);
    if (
      !district ||
      !location.quartier ||
      location.arrondissement !== district ||
      card.arrondissements.length !== 1
    )
      continue;
    if (!byDistrict.has(district)) byDistrict.set(district, []);
    byDistrict.get(district).push({ job, photo, proof, card });
  }
  if (byDistrict.size < 20)
    throw Error(
      "Missing verified photographs for one or more Paris arrondissements",
    );
  const districts = [...byDistrict.keys()].sort((a, b) =>
    a.localeCompare(b, "fr"),
  );
  for (const values of byDistrict.values())
    values.sort((a, b) =>
      crypto
        .createHash("sha256")
        .update("parici-2027:" + a.job.name)
        .digest("hex")
        .localeCompare(
          crypto
            .createHash("sha256")
            .update("parici-2027:" + b.job.name)
            .digest("hex"),
        ),
    );
  const additions = [],
    recent = manifest.slice(-3).map((r) => r.arrondissement);
  let date = last,
    offset = 0;
  while (date < through) {
    const next = new Date(date + "T12:00:00Z");
    next.setUTCDate(next.getUTCDate() + 1);
    date = next.toISOString().slice(0, 10);
    let picked;
    for (let i = 0; i < districts.length; i++) {
      const district = districts[(offset + i) % districts.length];
      if (recent.includes(district) || !byDistrict.get(district).length)
        continue;
      picked = byDistrict.get(district).shift();
      offset = (offset + i + 1) % districts.length;
      break;
    }
    if (!picked) throw Error("Verified photo pool exhausted");
    const { job, photo, proof, card } = picked;
    const name = `${date}__verified-${proof.sha256.slice(0, 16)}.jpg`;
    const image = "/data/daily_images/" + name;
    fs.copyFileSync(path.join(root, photo.image), path.join(root, image));
    const district = `${card.arrondissement}${card.arrondissement === 1 ? "er" : "e"} arrondissement`;
    additions.push([date, job.name, district, name, ""]);
    recent.push(district);
    if (recent.length > 3) recent.shift();
    audit.entries.push({
      date,
      street: job.name,
      cardKey: job.key,
      image,
      sha256: proof.sha256,
      coordinate: proof.coordinate,
      target: job.target,
      panoId: proof.panoId,
      captureDate: proof.captureDate,
      copyright: proof.copyright,
      heading: proof.heading,
      pitch: proof.pitch,
      fov: proof.fov,
      distanceMeters: proof.distanceMeters,
      reviewedAt: proof.reviewedAt,
      visualReview: true,
      framing: proof.evidence,
      sourceImage: photo.image,
      scheduledAt: new Date().toISOString().slice(0, 10),
    });
  }
  const cell = (v) =>
    /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  const csv =
    original.trimEnd() +
    "\n" +
    additions.map((row) => row.map(cell).join(",")).join("\n") +
    "\n";
  fs.writeFileSync(file, csv);
  fs.writeFileSync(
    path.join(root, "backend/data/daily_images/manifest_next_30.csv"),
    csv,
  );
  fs.writeFileSync(auditFile, JSON.stringify(audit, null, 2) + "\n");
  return { added: additions.length, through: date };
}
if (require.main === module) console.log(extendCalendar(process.argv[2]));
module.exports = { extendCalendar };
