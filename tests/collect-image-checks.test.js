const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
test("editorial image checks retain responsive paths without hashing; player URLs remain versioned", () => {
  let imageReads = 0, stats = 0;
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, "../backend/domains/collect/image-urls.js"), "utf8");
  const context = vm.createContext({
    module, URL,
    __dirname: path.join(__dirname, "../backend/domains/collect"),
    require(name) {
      if (name === "node:fs") return {
        existsSync: () => true,
        statSync: () => { stats++; return { mtimeMs: 1 }; },
        readFileSync(file) {
          if (file.endsWith("responsive.json")) return JSON.stringify({ "/data/photo.jpg": { detail: "/data/detail.jpg", thumbnail: "/data/thumb.jpg" } });
          imageReads++;
          return Buffer.from("photo");
        },
      };
      return require(name);
    },
  });
  vm.runInContext(source, context);
  const { imageVariants } = module.exports;
  const checks = imageVariants("/data/photo.jpg", { versioned: false });
  assert.equal(checks.image_reference, "/data/detail.jpg");
  assert.equal(checks.image_thumbnail, "/data/thumb.jpg");
  assert.equal(imageReads, 0);
  assert.equal(stats, 0);
  const player = imageVariants("/data/photo.jpg");
  assert.match(player.image_reference, /^\/data\/detail\.jpg\?v=[a-f0-9]{16}$/);
  assert.match(player.image_thumbnail, /^\/data\/thumb\.jpg\?v=[a-f0-9]{16}$/);
  assert.equal(imageReads, 2);
});
