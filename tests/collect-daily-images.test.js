const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  dailyImageForStreet,
} = require("../backend/domains/collect/daily-image");
test("Daily uses editorial card corrections and never substitutes cartographic clues for photos", async () => {
  const pool = (image) => ({ query: async () => ({ rows: [image] }) });
  assert.equal(
    await dailyImageForStreet(
      pool({ image: "/map.svg", image_override: null }),
      "Rue",
      "/photo.jpg",
    ),
    "/photo.jpg",
  );
  assert.equal(
    await dailyImageForStreet(
      pool({ image: "/corrected.jpg", image_override: "/corrected.jpg" }),
      "Rue",
      "/old.jpg",
    ),
    "/corrected.jpg",
  );
  assert.equal(
    await dailyImageForStreet(
      pool({ image: "/map.svg", image_override: "/map.svg" }),
      "Rue",
      "/photo.jpg",
    ),
    "/photo.jpg",
  );
  assert.equal(
    await dailyImageForStreet(
      { query: async () => ({ rows: [] }) },
      "Rue",
      "/photo.jpg",
    ),
    "/photo.jpg",
  );
});
