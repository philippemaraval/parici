"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { rarityDrawWeights } = require("../backend/domains/collect/rules");

test("each individual card becomes less likely from common to epic within its group", () => {
  const weights = rarityDrawWeights();
  assert.deepEqual(weights, [2, 1.5, 1, 0.8, 0.8]);
  // Uneven populations must not invert the probability for an individual card.
  // Aggregated rarity totals are allowed to differ from the per-card order.
  for (const counts of [
    [1, 1, 1, 1, 1],
    [385, 691, 978, 2786, 14],
    [369, 915, 1022, 2981, 12],
    [1000, 1, 100, 10000, 5],
  ]) {
    const mass = counts.reduce((sum, count, i) => sum + count * weights[i], 0);
    const perCard = weights.map((weight) => weight / mass);
    assert.ok(perCard[0] > perCard[1]);
    assert.ok(perCard[1] > perCard[2]);
    assert.ok(perCard[2] > perCard[3]);
    assert.ok(Math.abs(perCard[1] / perCard[0] - 0.75) < 1e-12);
    assert.ok(Math.abs(perCard[2] / perCard[0] - 0.5) < 1e-12);
    assert.ok(Math.abs(perCard[3] / perCard[0] - 0.4) < 1e-12);
    assert.ok(
      Math.abs(counts.reduce((sum, n, i) => sum + n * perCard[i], 0) - 1) <
        1e-12,
    );
  }
});

test("invalid weights fall back to the new defaults while explicit overrides remain supported", () => {
  assert.deepEqual(
    rarityDrawWeights({ 1: 3, 2: -1, 3: 0, 4: "bad", 5: 0.5 }),
    [3, 1.5, 1, 0.8, 0.5],
  );
  assert.equal(rarityDrawWeights({ 2: 1.25 })[1], 1.25);
});
