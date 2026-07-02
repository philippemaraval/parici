const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

test("mobile sessions reset stale setup scrolling instead of centering the target panel", () => {
  const source = fs.readFileSync(path.join(ROOT, "src", "app.js"), "utf8");
  const start = source.indexOf("function scrollSidebarToTargetPanel()");
  const end = source.indexOf("function ensureLectureBackButton()", start);
  const helper = source.slice(start, end);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.match(helper, /sidebar\.scrollTop = 0/);
  assert.match(helper, /window\.scrollTo\(\{ top: 0, left: 0, behavior: "auto" \}\)/);
  assert.match(helper, /requestAnimationFrame\(resetSessionScroll\)/);
  assert.doesNotMatch(helper, /behavior: "smooth"/);
});

test("mobile Daily hints scroll without progressively covering the map", () => {
  const styles = fs.readFileSync(path.join(ROOT, "style.css"), "utf8");

  assert.match(
    styles,
    /body\.session-running #daily-guesses-history\s*\{[^}]*max-height:\s*min\(24vh,\s*180px\);[^}]*overflow-y:\s*auto;/s,
  );
  assert.match(
    styles,
    /\.target-panel\.target-panel--daily-image-open\s+#daily-guesses-history\s*\{[^}]*max-height:\s*none;[^}]*overflow-y:\s*visible;/s,
  );
});
