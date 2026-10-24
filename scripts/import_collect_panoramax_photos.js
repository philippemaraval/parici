#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { plan } = require("./enrich_collect_paris_photos");
const {
  viewAlongStreet,
  axisDifference,
} = require("./lib/collect-street-view");

const root = path.resolve(__dirname, "..");
const approvedFile = process.argv[2];
const imageDirectory = process.argv[3];
if (!approvedFile || !imageDirectory)
  throw Error(
    "Usage: node scripts/import_collect_panoramax_photos.js approved.json image-directory",
  );
const approved = JSON.parse(fs.readFileSync(approvedFile, "utf8"));
const jobs = new Map(plan({ allStreets: true }).map((job) => [job.key, job]));
const manifestFile = path.join(root, "data/collect_photos_paris.json");
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
const seenPictures = new Set();
const auditFile = path.join(
  root,
  "data/collect_images/view-audit-20261014.json",
);
const audit = JSON.parse(fs.readFileSync(auditFile, "utf8"));
for (const decision of approved) {
  const { key, candidate, file } = decision;
  const job = jobs.get(key);
  if (!job || job.family !== "street" || manifest[key])
    throw Error(`Unknown or already photographed card: ${key}`);
  if (!/^[a-f0-9-]{36}$/.test(candidate.id) || seenPictures.has(candidate.id))
    throw Error(`Duplicate or invalid Panoramax picture: ${key}`);
  seenPictures.add(candidate.id);
  if (
    candidate.license !== "CC-BY-SA-4.0" ||
    !candidate.producer ||
    !candidate.datetime ||
    Number(candidate.datetime.slice(0, 4)) < 2016 ||
    !candidate.source?.startsWith(
      "https://api.panoramax.xyz/api/collections/",
    ) ||
    !candidate.sd?.startsWith("https://")
  )
    throw Error(`Missing Panoramax license or origin: ${key}`);
  const axis = viewAlongStreet(candidate.coordinate, job.features);
  if (
    !axis ||
    axis.distanceMeters > 18 ||
    (Number.isFinite(candidate.azimuth) &&
      axisDifference(candidate.azimuth, axis.heading) > 45)
  )
    throw Error(`Panoramax picture outside street axis: ${key}`);
  const bytes = fs.readFileSync(path.join(imageDirectory, path.basename(file)));
  if (bytes.length < 8000 || bytes[0] !== 255 || bytes[1] !== 216)
    throw Error(`Invalid Panoramax JPEG: ${key}`);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const filename = `panoramax-${candidate.id}.jpg`;
  fs.writeFileSync(path.join(root, "data/collect_images", filename), bytes);
  audit.cards[key] = {
    image: "/data/collect_images/" + filename,
    sha256,
    visualReview: true,
    reviewedAt: new Date().toISOString().slice(0, 10),
    status: "retained",
    framing:
      "Vue de l’axe de la voie ou entrée identifiable retenue après contrôle visuel.",
    geographicEvidence: "capture-coordinate-and-local-street-axis",
  };
  manifest[key] = {
    image: "/data/collect_images/" + filename,
    source: "panoramax",
    kind: "photograph",
    caption: "Photographie de la voie",
    author: candidate.producer,
    license: candidate.license,
    sourcePage: `https://api.panoramax.xyz/?pic=${candidate.id}`,
    verifiedEntity: key,
    verification: {
      method: "geometry-local-axis-and-visual-review",
      reviewedAt: new Date().toISOString().slice(0, 10),
      coordinate: candidate.coordinate,
      target: job.target,
      distanceMeters: Math.round(axis.distanceMeters * 10) / 10,
      captureDate: candidate.datetime,
      pictureId: candidate.id,
      azimuth: candidate.azimuth,
      streetHeading: axis.heading,
      metadataPage: candidate.source,
      sha256,
      evidence: "Vue de l'axe de la voie retenue après contrôle visuel.",
    },
  };
}
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
fs.writeFileSync(auditFile, JSON.stringify(audit));
console.log(`Panoramax photographs imported: ${approved.length}`);
