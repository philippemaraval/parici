const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

test("daily share image centres the visual hint without emoji font metrics", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/daily-runtime.js"), "utf8");

  assert.match(source, /const visualHintLabel = "Indice visuel"/);
  assert.match(source, /ctx\.measureText\(visualHintLabel\)\.width/);
  assert.match(source, /const visualHintX = bestCenterX - visualHintWidth \/ 2/);
  assert.match(source, /ctx\.fillText\(visualHintLabel, visualHintX \+ visualHintIconSize \+ visualHintGap, visualHintY\)/);
  assert.doesNotMatch(source, /ctx\.fillText\("🖼️ Indice visuel"/);
});
