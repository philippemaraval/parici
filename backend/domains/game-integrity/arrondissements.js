"use strict";

function normalizeQuarterLookupKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, " ")
    .replace(/-/g, " ")
    .replace(/^quartier\s+/, "")
    .replace(/^(?:de\s+l|de\s+la|de|du|des|d|le|la|les)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function createArrondissementResolver(payload) {
  const arrondissementByQuarter = new Map();
  (payload.features || []).forEach((feature) => {
    const properties = feature?.properties || {};
    const quarterName = normalizeQuarterLookupKey(properties.l_qu);
    const arrondissementNumber = Number(properties.c_ar);
    if (
      quarterName &&
      arrondissementNumber >= 1 &&
      arrondissementNumber <= 20
    ) {
      arrondissementByQuarter.set(quarterName, arrondissementNumber);
    }
  });

  const quarterAliases = new Map([
    ["plaine de monceau", 17],
    ["plaine de monceaux", 17],
    ["amerique", 19],
    ["iles", 4],
    ["auteuil", 16],
    ["europe", 8],
    ["odeon", 6],
    ["hopital saint louis", 10],
    ["ecole militaire", 7],
    ["arsenal", 4],
    ["vendome", 1],
    ["sainte avoye", 3],
  ]);

  return (value) => {
    const current = String(value || "").trim();
    if (/^\d{1,2}(?:er|e)?\s+arrondissement$/i.test(current)) return current;
    const key = normalizeQuarterLookupKey(current);
    const number = arrondissementByQuarter.get(key) || quarterAliases.get(key);
    return number
      ? number === 1
        ? "1er arrondissement"
        : `${number}e arrondissement`
      : current;
  };
}

module.exports = { createArrondissementResolver };
