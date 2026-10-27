"use strict";

const DEFAULT_FAMILY_WEIGHTS = Object.freeze({
  street: 70,
  district: 10,
  monument: 10,
  bus: 10,
});

const DEFAULT_RARITY_DRAW_WEIGHTS = Object.freeze({
  1: 2,
  2: 1.5,
  3: 1,
  4: 0.8,
  5: 0.8,
});

function rarityDrawWeights(config = {}) {
  return [1, 2, 3, 4, 5].map((rarity) => {
    const value = Number(config?.[rarity]);
    return Number.isFinite(value) && value > 0
      ? value
      : DEFAULT_RARITY_DRAW_WEIGHTS[rarity];
  });
}

function chooseFamily(weights = DEFAULT_FAMILY_WEIGHTS, random = Math.random) {
  const entries = Object.entries(weights).filter(
    ([, weight]) => Number.isFinite(Number(weight)) && Number(weight) > 0,
  );
  const total = entries.reduce((sum, [, weight]) => sum + Number(weight), 0);
  if (!total)
    throw new Error("Collect family weights must have a positive total");
  let roll = random() * total;
  for (const [family, weight] of entries) {
    roll -= Number(weight);
    if (roll < 0) return family;
  }
  return entries[entries.length - 1][0];
}

// These weights are percentages of all draws and sum to the 70% street share.
const STREET_GROUP_WEIGHTS = Object.freeze({ famous: 8, main: 18, other: 44 });

function normalizeStreetName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’`´]/g, "'")
    .replace(/[-‐‑‒–—]/g, "-")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ");
}

function resolveStreetGroups(streets, lists) {
  const famous = new Set(lists.famousStreets.map(normalizeStreetName));
  const main = new Set(lists.mainStreets.map(normalizeStreetName));
  const groups = { famous: [], main: [] };
  for (const street of streets) {
    const names = [street.name, street.osmName]
      .filter(Boolean)
      .map(normalizeStreetName);
    if (names.some((name) => famous.has(name))) groups.famous.push(street.name);
    else if (names.some((name) => main.has(name)))
      groups.main.push(street.name);
  }
  return groups;
}

function rewardDecision({ correct, copiesInWindow, limit = 4 }) {
  const rewardAvailable = Number(copiesInWindow) < Number(limit);
  return {
    rewardAvailable,
    rewardGranted: Boolean(correct) && rewardAvailable,
  };
}

module.exports = {
  DEFAULT_FAMILY_WEIGHTS,
  DEFAULT_RARITY_DRAW_WEIGHTS,
  rarityDrawWeights,
  STREET_GROUP_WEIGHTS,
  chooseFamily,
  resolveStreetGroups,
  normalizeStreetName,
  rewardDecision,
};
