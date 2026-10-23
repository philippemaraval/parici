"use strict";
const { createArrondissementResolver } = require("./arrondissements");
const key = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, " ")
    .replace(/-/g, " ")
    .replace(/^quartier\s+/, "")
    .replace(/^(?:de\s+l|de\s+la|de|du|des|d|le|la|les)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
const numberOf = (value) => {
  const match = String(value || "").match(
    /^(\d{1,2})(?:er|e)?(?:\s+arrondissement)?$/i,
  );
  const number = Number(match?.[1]);
  return number >= 1 && number <= 20 ? number : null;
};
function createDailyLocationResolver(quarters) {
  const resolve = createArrondissementResolver(quarters);
  const byName = new Map(
    quarters.features.map(({ properties: p }) => [key(p.l_qu), p]),
  );
  return (stored, street = {}) => {
    const number = numberOf(stored);
    const candidates = [stored, street?.quartier, street?.arrondissement];
    const quarter = candidates
      .map(
        (value) =>
          byName.get(key(value)) ||
          (!numberOf(value) && numberOf(resolve(value))
            ? {
                l_qu: String(value).replace(/^quartier\s+/i, ""),
                c_ar: numberOf(resolve(value)),
              }
            : null),
      )
      .find((value) => value && (!number || Number(value.c_ar) === number));
    const arrondissement =
      number ||
      Number(quarter?.c_ar) ||
      numberOf(resolve(stored)) ||
      numberOf(resolve(street?.arrondissement));
    return {
      arrondissement: arrondissement
        ? `${arrondissement}${arrondissement === 1 ? "er" : "e"} arrondissement`
        : null,
      quartier: quarter?.l_qu || null,
    };
  };
}
module.exports = { createDailyLocationResolver };
