const test = require("node:test");
const assert = require("node:assert/strict");
const security = require("../backend/domains/admin/security");
const editorial = require("../backend/domains/admin/editorial");
const selection = require("../src/public/js/explorer-selection");
test("TOTP uses the RFC counter vector; encrypted secrets reject tampering", () => {
  security.configure("local-test-key");
  const secret = security.base32(Buffer.from("12345678901234567890"));
  assert.equal(security.totp(secret, 1), "287082");
  const encrypted = security.encrypt(secret);
  assert.ok(!encrypted.includes(secret));
  assert.equal(security.decrypt(encrypted), secret);
  const b = Buffer.from(encrypted, "base64");
  b[14] ^= 1;
  assert.throws(() => security.decrypt(b.toString("base64")));
});
test("editorial fingerprints survive JSONB key ordering and dates", () => {
  assert.equal(
    editorial.fingerprint({ a: 1, b: { c: 2, d: 3 } }),
    editorial.fingerprint({ b: { d: 3, c: 2 }, a: 1 }),
  );
  assert.equal(
    editorial.fingerprint({ date: new Date("2026-10-12T12:00Z") }),
    editorial.fingerprint({ date: "2026-10-12T12:00:00.000Z" }),
  );
  assert.notEqual(
    editorial.fingerprint({ a: 1 }),
    editorial.fingerprint({ a: 2 }),
  );
});
test("daily preparation rejects invalid dates, partial coordinates and unverified images", () => {
  const base = {
    date: "2099-01-01",
    street_name: "Rue test",
    quartier: "Test",
    coordinates: [2.3522, 48.8566],
    image_url: "https://example.test/image.png",
    verified: true,
  };
  assert.equal(editorial.validate("daily", base).date, base.date);
  for (const p of [
    { date: "2099-02-31" },
    { date: "invalid" },
    { coordinates: [5.38] },
    { coordinates: [5.38, 91] },
    { verified: false },
    { image_url: "javascript:alert(1)" },
  ])
    assert.throws(() => editorial.validate("daily", { ...base, ...p }));
});
test("Explorer preserves closest first and uniform choice among five nearest", () => {
  const ranked = Array.from({ length: 10 }, (_, id) => ({
    riddle: { id },
    distance: id * 100,
  }));
  assert.equal(selection.choose(ranked, true, () => 0.99).id, 0);
  assert.equal(selection.choose(ranked, false, () => 0.99).id, 4);
  assert.equal(selection.candidatePool(ranked, false).length, 5);
  const index = selection.buildIndex([
    {
      properties: { name: "Rue Test" },
      geometry: {
        type: "LineString",
        coordinates: [
          [2.3522, 48.8566],
          [2.3622, 48.8566],
        ],
      },
    },
  ]);
  assert.ok(
    selection.distance(
      { latitude: 48.8566, longitude: 2.3572 },
      { street_name_clean: "Rue Test" },
      index,
    ) < 1,
  );
});
test("legacy routes require publishing/support permissions even when mounted", () => {
  assert.equal(
    security.legacyPermission("/api/explorer/admin/riddles", "PUT"),
    "publish",
  );
  assert.equal(
    security.legacyPermission("/api/editor/users/1", "DELETE"),
    "support",
  );
  assert.equal(
    security.legacyPermission("/api/editor/collect/cards/1/rarity", "PUT"),
    "balance",
  );
  assert.equal(
    security.legacyPermission("/api/editor/studio/tasks", "GET"),
    null,
  );
});
