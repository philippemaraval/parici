const test = require("node:test");
const assert = require("node:assert/strict");
const weekly = require("../backend/domains/collect/weekly-challenge");
const { rewardPolicy } = require("../backend/domains/collect/weekly-rewards");

function dimensions(count = 12) {
  return [
    ...Array.from({ length: count }, (_, i) => ({
      card_id: i + 1,
      family: "street",
      arrondissement: i + 1,
      quartier: `Quartier ${i + 1}`,
      famous: i < 4,
      main: i >= 4 && i < 8,
    })),
    ...["monument", "bus", "district"].flatMap((family) =>
      Array.from({ length: count }, (_, i) => ({
        card_id: `${family}-${i}`,
        family,
      })),
    ),
  ];
}

test("weekly generation keeps two or three diverse goals and adjusts reward difficulty", () => {
  const smallest = weekly.chooseObjectives(dimensions(), () => 0);
  assert.deepEqual(
    smallest.map((o) => [o.kind, o.target]),
    [
      ["arrondissement", 5],
      ["monument", 3],
    ],
  );
  assert.equal(rewardPolicy(smallest).difficulty, "intermédiaire");
  const largest = weekly.chooseObjectives(dimensions(), (max) => max - 1);
  assert.deepEqual(
    largest.map((o) => [o.kind, o.target]),
    [
      ["main", 4],
      ["district", 5],
      ["famous", 4],
    ],
  );
  assert.equal(new Set(largest.map((o) => o.kind)).size, 3);
  assert.equal(rewardPolicy(largest).difficulty, "intermédiaire");
});

test("weekly targets stop at available distinct cards and exclude impossible goals", () => {
  const limited = weekly.chooseObjectives(dimensions(4), (max) => max - 1);
  assert.deepEqual(
    limited.map((o) => [o.kind, o.target]),
    [
      ["famous", 4],
      ["district", 4],
      ["bus", 4],
    ],
  );
  assert.throws(() => weekly.chooseObjectives(dimensions(2)), /too small/);
});
