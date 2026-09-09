const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

test("mobile session target is viewport-anchored without scrolling the Android visual viewport", () => {
  const appSource = fs.readFileSync(path.join(ROOT, "src", "app.js"), "utf8");
  const cssSource = fs.readFileSync(path.join(ROOT, "style.css"), "utf8");
  const start = appSource.indexOf("function scrollSidebarToTargetPanel()");
  const end = appSource.indexOf("function ensureLectureBackButton()", start);
  const helper = appSource.slice(start, end);
  const mobileSessionStart = cssSource.indexOf("body.session-running #sidebar {");
  const mobileSessionEnd = cssSource.indexOf("body.session-running #map {", mobileSessionStart);
  const mobileSessionRule = cssSource.slice(mobileSessionStart, mobileSessionEnd);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.notEqual(mobileSessionStart, -1);
  assert.notEqual(mobileSessionEnd, -1);
  assert.match(helper, /sidebar\.scrollTop = 0/);
  assert.match(helper, /requestAnimationFrame\(resetSessionScroll\)/);
  assert.doesNotMatch(helper, /window\.scrollTo/);
  assert.match(mobileSessionRule, /position: fixed/);
  assert.match(mobileSessionRule, /top: env\(safe-area-inset-top, 0\)/);
  assert.match(
    cssSource,
    /body\.session-running \.mobile-mode-nav \{\s*display: none !important;/,
  );
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
