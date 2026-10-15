"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  applyCuratedRarities,
  revision,
} = require("../backend/domains/collect/curated-rarities");
const catalog = require("../data/collect_paris_catalog.json");
const prepared = require("../data/collect_paris_fragments.json");
const bank = require("../reports/collect-fragment-qcm-review/questions.json");

test("reviewed rarities run once and preserve manual or game-evaluated rarities", async () => {
  const calls = [];
  await applyCuratedRarities({
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rows: [] };
    },
  });
  assert.equal(calls.length, 3);
  const update = calls[1];
  assert.match(update.sql, /COALESCE\(c.base_rarity_override,r.base_rarity\)/);
  assert.match(
    update.sql,
    /c.rarity_override IS NULL AND c.rarity_evaluated_at IS NULL/,
  );
  assert.match(update.sql, /NOT EXISTS\(SELECT 1 FROM card_rarity_history/);
  const records = JSON.parse(update.values[0]);
  const identities = new Set(
    catalog.records.map((c) => c.family + ":" + c.source_entity_id),
  );
  assert.ok(
    records.every((c) => identities.has(c.family + ":" + c.source_entity_id)),
  );
  assert.equal(
    new Set(records.map((c) => c.family + ":" + c.source_entity_id)).size,
    records.length,
  );
  assert.equal(calls[2].values[0], revision);
  let repeated = 0;
  await applyCuratedRarities({
    query: async () => {
      repeated++;
      return { rows: [{ value_text: revision }] };
    },
  });
  assert.equal(repeated, 1);
});

test("all legendary fragment assignments are reviewable without activating empty banks", () => {
  assert.equal(bank.cards.length, 102);
  assert.equal(
    bank.cards.reduce((n, c) => n + c.questions.length, 0),
    299,
  );
  const cards = new Map(
    catalog.records.map((c) => [c.family + ":" + c.source_entity_id, c]),
  );
  for (const card of bank.cards) {
    const key = card.family + ":" + card.source_entity_id;
    assert.equal(prepared[key], card.fragments);
    assert.equal(card.questions.length, card.fragments);
    const active = cards.get(key);
    assert.ok(active.base_rarity === 5 || active.fragments_required > 0);
    if (!active.questions.length) assert.equal(active.fragments_required, 0);
  }
  assert.equal(catalog.records.filter((c) => c.fragments_required).length, 18);
});
