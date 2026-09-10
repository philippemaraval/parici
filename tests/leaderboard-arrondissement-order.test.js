const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("street leaderboards sort arrondissement sections from 1 to 20", () => {
  const source = fs.readFileSync(
    path.join(root, "src", "leaderboard.js"),
    "utf8",
  );

  assert.match(
    source,
    /const leftNumber = Number\.parseInt\(leftName\.match\(\/\^\\d\{1,2\}/,
  );
  assert.match(
    source,
    /const rightNumber = Number\.parseInt\(rightName\.match\(\/\^\\d\{1,2\}/,
  );
  assert.match(source, /return leftNumber - rightNumber/);
});
