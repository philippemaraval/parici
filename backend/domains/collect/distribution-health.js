"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const {
  DEFAULT_FAMILY_WEIGHTS,
  STREET_GROUP_WEIGHTS,
  rarityDrawWeights,
  resolveStreetGroups,
} = require("./rules");
async function distributionHealth(db, lists) {
  const cards = (
    await db.pool.query(
      "SELECT id,family,source_entity_id,current_rarity,fragments_enabled FROM cards c WHERE status='active' AND catalog_present AND NOT EXISTS(SELECT 1 FROM collect_card_merges WHERE source_card_id=c.id)",
    )
  ).rows;
  const configurations = (
    await db.pool.query(
      "SELECT key,value_json FROM collect_config WHERE key IN('family_weights','street_category_weights','rarity_draw_weights')",
    )
  ).rows;
  const config = Object.fromEntries(
    configurations.map((c) => [c.key, c.value_json]),
  );
  const groups = resolveStreetGroups(
    JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../../data/streets_index.json")),
    ),
    { famousStreets: lists.famousStreets, mainStreets: lists.mainStreets },
  );
  const famous = new Set(groups.famous),
    main = new Set(groups.main);
  const category = (card) =>
    card.family === "street"
      ? famous.has(card.source_entity_id)
        ? "famous"
        : main.has(card.source_entity_id)
          ? "main"
          : "other"
      : card.family;
  const families = { ...DEFAULT_FAMILY_WEIGHTS, ...config.family_weights },
    street = { ...STREET_GROUP_WEIGHTS, ...config.street_category_weights },
    weights = rarityDrawWeights(config.rarity_draw_weights);
  const familyTotal = Object.values(families).reduce(
      (a, b) => a + Number(b),
      0,
    ),
    streetTotal = Object.values(street).reduce((a, b) => a + Number(b), 0);
  const categories = Object.fromEntries(
    ["famous", "main", "other", "district", "monument", "bus"].map((key) => [
      key,
      {
        category: key,
        cards: 0,
        expectedPercent:
          100 *
          (key in street
            ? ((Number(families.street) / familyTotal) * Number(street[key])) /
              streetTotal
            : Number(families[key]) / familyTotal),
        observed: 0,
      },
    ]),
  );
  const masses = {};
  for (const card of cards) {
    const key = category(card),
      rarity = card.fragments_enabled ? 5 : Number(card.current_rarity);
    categories[key].cards++;
    masses[key] ||= [0, 0, 0, 0, 0];
    masses[key][rarity - 1] += weights[rarity - 1];
  }
  const games = (
    await db.pool.query(
      "SELECT c.family,c.source_entity_id,COUNT(*)::int AS count FROM collect_games g JOIN cards c ON c.id=g.card_id WHERE g.started_at>=NOW()-INTERVAL '30 days' GROUP BY c.family,c.source_entity_id",
    )
  ).rows;
  let samples = 0;
  for (const game of games) {
    categories[category(game)].observed += game.count;
    samples += game.count;
  }
  const rarityPercent = [0, 0, 0, 0, 0];
  for (const [key, mass] of Object.entries(masses)) {
    const sum = mass.reduce((a, b) => a + b, 0);
    mass.forEach(
      (v, i) =>
        (rarityPercent[i] += (categories[key].expectedPercent * v) / sum),
    );
  }
  return {
    categories: Object.values(categories),
    rarityPercent,
    samples,
    periodDays: 30,
    note: "Les catégories observées utilisent le classement actuel du catalogue. Les poids supposent des catégories non vides.",
  };
}
module.exports = { distributionHealth };
