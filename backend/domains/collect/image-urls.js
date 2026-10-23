"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const root = path.resolve(__dirname, "../../.."),
  cache = new Map();
let responsive;
function imageVariants(url, { versioned = true } = {}) {
  if (!responsive) {
    const file = path.join(root, "data/collect_images/responsive.json");
    responsive = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {};
  }
  const variants = responsive[url];
  return {
    image_reference: versioned
      ? versionedImage(variants?.detail || url)
      : variants?.detail || url,
    image_thumbnail: versioned
      ? versionedImage(variants?.thumbnail || url)
      : variants?.thumbnail || url,
  };
}
function versionedImage(url) {
  if (typeof url !== "string" || !url.startsWith("/data/")) return url;
  const parsed = new URL(url, "https://camino.invalid"),
    file = path.resolve(root, "." + parsed.pathname);
  if (!file.startsWith(root + path.sep)) return url;
  try {
    const stat = fs.statSync(file),
      entry = cache.get(file);
    const hash =
      entry?.mtime === stat.mtimeMs
        ? entry.hash
        : crypto
            .createHash("sha256")
            .update(fs.readFileSync(file))
            .digest("hex")
            .slice(0, 16);
    cache.set(file, { mtime: stat.mtimeMs, hash });
    parsed.searchParams.set("v", hash);
    return parsed.pathname + parsed.search;
  } catch {
    return url;
  }
}
module.exports = { imageVariants, versionedImage };
