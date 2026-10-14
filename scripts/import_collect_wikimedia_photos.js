#!/usr/bin/env node
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const { distance } = require("./lib/collect-street-view");
const [approvedFile, imageDirectory] = process.argv.slice(2);
if (!approvedFile || !imageDirectory)
  throw Error(
    "Usage: node scripts/import_collect_wikimedia_photos.js approved.json image-directory",
  );
const approvals = JSON.parse(fs.readFileSync(approvedFile, "utf8"));
const catalog = new Map(
  require("../data/collect_paris_catalog.json").records.map((c) => [
    c.family + ":" + c.source_entity_id,
    c,
  ]),
);
const manifestFile = path.join(root, "data/collect_photos_paris.json");
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
function plain(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_, n) =>
      String.fromCodePoint(
        n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n),
      ),
    )
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp|copy);/g,
      (_, n) =>
        ({
          amp: "&",
          lt: "<",
          gt: ">",
          quot: '"',
          apos: "'",
          nbsp: " ",
          copy: "©",
        })[n],
    )
    .replace(/\s+/g, " ")
    .trim();
}
const prepared = approvals.map((decision) => {
  const card = catalog.get(decision.key),
    info = decision.commons,
    metadata = info?.extmetadata;
  const license = plain(metadata?.LicenseShortName?.value)
      .replace(/^CC-BY-SA-/, "CC BY-SA ")
      .replace(/^CC-BY-/, "CC BY "),
    author = plain(metadata?.Artist?.value);
  if (
    !card ||
    manifest[decision.key] ||
    card.illustration.kind === "photograph"
  )
    throw Error("Unknown or already photographed card: " + decision.key);
  const articleLocation = decision.page.coordinates?.[0];
  if (
    card.family === "street" &&
    (!articleLocation ||
      !card.centroid ||
      distance([articleLocation.lon, articleLocation.lat], card.centroid) > 350)
  )
    throw Error("Street article location does not match card: " + decision.key);
  if (
    !/^(CC BY(?:-SA)? [234]\.0(?: de)?|CC BY-SA 2\.5|CC0|Public domain)$/.test(
      license,
    ) ||
    !author
  )
    throw Error("Missing reusable license or author: " + decision.key);
  if (
    !["commons.wikimedia.org", "fr.wikipedia.org"].includes(
      new URL(info.descriptionurl).hostname,
    ) ||
    new URL(info.url).hostname !== "upload.wikimedia.org"
  )
    throw Error("Invalid Wikimedia source: " + decision.key);
  const bytes = fs.readFileSync(
    path.join(imageDirectory, path.basename(decision.file)),
  );
  const jpeg = bytes[0] === 255 && bytes[1] === 216,
    png = bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
  if (bytes.length < 6000 || (!jpeg && !png))
    throw Error("Invalid photograph: " + decision.key);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const filename = `wikimedia-${sha256.slice(0, 24)}.${jpeg ? "jpg" : "png"}`;
  return {
    key: decision.key,
    bytes,
    filename,
    entry: {
      image: "/data/collect_images/" + filename,
      source: "wikipedia",
      kind: "photograph",
      caption:
        decision.caption ||
        (card.family === "bus"
          ? "Matériel roulant de la ligne"
          : card.family === "district"
            ? "Vue photographique du quartier"
            : card.family === "street"
              ? "Photographie de la voie"
              : "Photographie du lieu"),
      author,
      license,
      licenseUrl: metadata.LicenseUrl?.value || null,
      sourcePage: info.descriptionurl,
      verifiedEntity: decision.key,
      verification: {
        method: "article-identity-and-visual-review",
        reviewedAt: new Date().toISOString().slice(0, 10),
        articleTitle: decision.page.title,
        articleURL: `https://${decision.articleDomain || "fr.wikipedia.org"}/wiki/${encodeURIComponent(decision.page.title.replaceAll(" ", "_"))}`,
        articleCoordinate: articleLocation
          ? [articleLocation.lon, articleLocation.lat]
          : null,
        catalogTarget: card.centroid,
        commonsFile: decision.page.pageimage,
        originalURL: info.url,
        originalSHA1: info.sha1 || null,
        licenseURL: metadata.LicenseUrl?.value || null,
        captureDate:
          plain(metadata.DateTimeOriginal?.value || metadata.DateTime?.value) ||
          null,
        sha256,
        evidence:
          decision.evidence ||
          (card.family === "bus"
            ? "Matériel roulant visible, photo associée à l'article de la ligne et contrôlée visuellement."
            : "Sujet photographique identifiable, association à l'article du lieu contrôlée visuellement."),
      },
    },
  };
});
for (const item of prepared) {
  fs.writeFileSync(
    path.join(root, "data/collect_images", item.filename),
    item.bytes,
  );
  manifest[item.key] = item.entry;
}
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
console.log("Wikimedia photographs imported:", prepared.length);
