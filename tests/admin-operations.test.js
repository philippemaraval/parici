const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeRiddlePayload,
} = require("../backend/domains/explorer/validation");
const { decodeImage } = require("../backend/domains/admin/images");
const riddle = {
  way_id: 123,
  street_name_clean: "Rue test",
  riddle_text: "Question",
  hint_text: "Indice",
  image_url: "https://example.test/photo.png",
};

test("Explorer preserves empty coordinates and rejects partial, invalid and out-of-range points", () => {
  assert.deepEqual(
    normalizeRiddlePayload({
      ...riddle,
      latitude: "",
      longitude: "",
    }).values.slice(-2),
    [null, null],
  );
  for (const point of [
    { latitude: 91, longitude: 5 },
    { latitude: 43, longitude: -181 },
    { latitude: 43 },
    { latitude: "abc", longitude: "abc" },
  ])
    assert.equal(normalizeRiddlePayload({ ...riddle, ...point }).ok, false);
  assert.deepEqual(
    normalizeRiddlePayload({
      ...riddle,
      latitude: 43.3,
      longitude: 5.4,
    }).values.slice(-2),
    [43.3, 5.4],
  );
});

test("Explorer rejects unsafe image URLs", () => {
  assert.equal(
    normalizeRiddlePayload({ ...riddle, image_url: "javascript:alert(1)" }).ok,
    false,
  );
  assert.equal(
    normalizeRiddlePayload({
      ...riddle,
      image_url: "/data/explorer_uploads/test.png",
    }).ok,
    true,
  );
});

test("uploaded images use real type signatures and stable content addresses", () => {
  const valid =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=";
  const first = decodeImage(valid);
  assert.match(first.filename, /^[a-f0-9]{64}\.png$/);
  assert.equal(first.filename, decodeImage(valid).filename);
  assert.equal(decodeImage(valid.replace("image/png", "image/jpeg")), null);
  assert.equal(
    decodeImage(
      "data:image/png;base64," + Buffer.from("not an image").toString("base64"),
    ),
    null,
  );
  assert.equal(decodeImage("data:image/svg+xml;base64,PHN2Zz4="), null);
  assert.equal(
    decodeImage("data:image/png;base64," + "A".repeat(8_000_000)),
    null,
  );
});
