"use strict";
const articles = require("../../../data/collect_wikipedia.json");

// Prefer a checked place article; retain checked editorial links explaining
// the place name or history when no standalone article exists.
function wikipediaLink(family, entityId) {
  const entry = articles[`${family}:${entityId}`];
  if (!entry || family === "bus") return null;
  try {
    const url = new URL(entry.url);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "fr.wikipedia.org" ||
      !url.pathname.startsWith("/wiki/")
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
module.exports = { wikipediaLink };
