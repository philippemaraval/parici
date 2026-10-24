#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const sharp = require("sharp");
const root = path.resolve(__dirname, "..");
const read = (file) =>
  JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
async function optimizeImages() {
  const collect = Object.values(read("data/collect_images/manifest.json"));
  const explorer = read("data/explorer_paris.json");
  const urls = [
    ...new Set([
      ...collect.filter((v) => v.kind === "photograph").map((v) => v.image),
      ...explorer.map((v) => v.image_url),
    ]),
  ].sort();
  const registry = {},
    report = {
      images: urls.length,
      originalBytes: 0,
      thumbnailBytes: 0,
      detailBytes: 0,
    };
  for (const [index, url] of urls.entries()) {
    if (!url.startsWith("/data/"))
      throw new Error("Only local verified photographs can be optimized");
    const input = fs.readFileSync(path.join(root, url));
    const hash = crypto
      .createHash("sha256")
      .update(input)
      .digest("hex")
      .slice(0, 24);
    const folder = url.startsWith("/data/explorer_images/")
      ? "explorer_images"
      : "collect_images";
    const variants = {};
    const metadata = await sharp(input).metadata();
    for (const [name, width, quality] of [
      ["thumbnail", 320, 78],
      ["detail", 960, folder === "explorer_images" ? 78 : 85],
    ]) {
      const target = `/data/${folder}/optimized-${hash}-${width}.webp`;
      const file = path.join(root, target);
      if (
        name === "detail" &&
        folder !== "explorer_images" &&
        (metadata.width || 0) <= width &&
        input.length < 150 * 1024
      ) {
        variants[name] = url;
        report.detailBytes += input.length;
        if (fs.existsSync(file)) fs.unlinkSync(file);
        continue;
      }
      // Resize the entire frame, including embedded credits; never crop or enlarge.
      if (!fs.existsSync(file))
        await sharp(input)
          .rotate()
          .resize({ width, withoutEnlargement: true })
          .webp({ quality })
          .toFile(file);
      const bytes = fs.statSync(file).size;
      variants[name] = bytes < input.length ? target : url;
      report[name + "Bytes"] += Math.min(bytes, input.length);
      if (bytes >= input.length) fs.unlinkSync(file);
    }
    registry[url] = variants;
    report.originalBytes += input.length;
    if ((index + 1) % 500 === 0) console.log(`${index + 1}/${urls.length}`);
  }
  const collectRegistry = Object.fromEntries(
    Object.entries(registry).filter(
      ([url]) => !url.startsWith("/data/explorer_images/"),
    ),
  );
  fs.writeFileSync(
    path.join(root, "data/collect_images/responsive.json"),
    JSON.stringify(collectRegistry, null, 2) + "\n",
  );
  fs.writeFileSync(
    path.join(root, "data/explorer_images/manifest.json"),
    JSON.stringify(
      {
        version: 2,
        images: explorer.map((entry) => ({
          url: entry.image_url,
          ...registry[entry.image_url],
          source: "Google Street View",
          license: "Attribution conservée sur la photographie",
        })),
      },
      null,
      2,
    ) + "\n",
  );
  fs.mkdirSync(path.join(root, "docs/reports"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "docs/reports/image-variants.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(report);
}
if (require.main === module)
  optimizeImages().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { optimizeImages };
