"use strict";
const articles = require("../../../data/collect_wikipedia.json");

// Only reviewed place articles belong here. An eponym or a search result
// must not become a place link just because it appears in editorial sources.
function wikipediaLink(family, entityId) {
  const entry = articles[`${family}:${entityId}`];
  if (
    !entry ||
    entry.subject !== "place" ||
    !Number.isInteger(entry.pageId) ||
    entry.pageId <= 0 ||
    family === "bus" ||
    /^(?:Spécial|Special):/i.test(entry.title)
  )
    return null;
  try {
    const url = new URL(entry.url);
    if (
      url.protocol !== "https:" ||
      url.origin !== "https://fr.wikipedia.org" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.pathname.startsWith("/wiki/") ||
      decodeURIComponent(url.pathname.slice(6)).replace(/_/g, " ") !==
        entry.title
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
module.exports = { wikipediaLink };
