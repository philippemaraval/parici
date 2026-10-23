const { test, expect } = require("@playwright/test");
const esbuild = require("esbuild");
const path = require("node:path");
let bundle;
test.beforeAll(async () => {
  const built = await esbuild.build({
    stdin: {
      contents: `export { loadAllLeaderboards, createWeeklyLeaderboardCanvas } from './src/leaderboard.js'; export { handleDailyShareImageRuntime } from './src/daily-share-image.js';`,
      resolveDir: path.resolve(__dirname, "../.."),
    },
    bundle: true,
    write: false,
    format: "iife",
    globalName: "PariciRanking",
    platform: "browser",
  });
  bundle = built.outputFiles[0].text;
});

test("weekly image preserves server ranks and daily result keeps its original format", async ({
  page,
}, testInfo) => {
  const rows = Array.from({ length: 20 }, (_, index) => ({
    username:
      index === 0
        ? "Classé 20 avec un long pseudo"
        : `Classé ${String(20 - index).padStart(2, "0")}`,
    avatar: "👤",
    success: index < 18,
    attempts_count: index < 2 ? 1 : 2,
    solve_time_seconds: index === 0 ? 4.2 : 12.3,
    best_distance_meters: index * 50,
    total_distance_meters: index * 125,
    successes: 7,
    days_played: 7,
    total_attempts: 10,
  }));
  const weekly = { weekStart: "2026-10-19", weekEnd: "2026-10-25", rows };
  await page.route("**/__ranking_test?*", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<div class="user-sticker-name">Test</div><div id="leaderboard"></div>',
    }),
  );
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({
      json: url.pathname.endsWith("/weekly")
        ? weekly
        : url.pathname === "/api/daily/leaderboard"
          ? rows
          : [],
    });
  });
  await page.goto("/__ranking_test?view=daily");
  await page.evaluate(() => {
    window.CaminoRuntimeConfig = { apiUrl: location.origin };
  });
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async () => {
    const painted = [];
    const draw = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (
      text,
      x,
      y,
      ...args
    ) {
      painted.push({ text: String(text), x, y });
      return draw.call(this, text, x, y, ...args);
    };
    const snapshot = await PariciRanking.loadAllLeaderboards();
    const dayPage = [
      ...document.querySelectorAll(".daily-current-leaderboard tbody tr"),
    ].map((row) => ({
      name:
        row.querySelector(".leaderboard-player-name")?.textContent ||
        Array.from(row.cells[1].childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent)
          .join("")
          .trim(),
      result: row.cells[2].textContent,
    }));
    const weekPage = [
      ...document.querySelectorAll(".weekly-daily-leaderboard tbody tr"),
    ].map((row) =>
      Array.from(row.cells[1].childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent)
        .join("")
        .trim(),
    );
    const payload = {
      weekStart: "2026-10-19",
      weekEnd: "2026-10-25",
      rows: snapshot.rows,
    };
    const weeklyCanvas = await PariciRanking.createWeeklyLeaderboardCanvas(
      payload,
      "Test",
    );
    document.body.append(weeklyCanvas);
    weeklyCanvas.id = "weekly-canvas";
    const weeklyNames = painted
      .filter((p) => p.text.startsWith("Classé "))
      .map((p) => p.text);
    painted.length = 0;
    let sharedCanvas;
    HTMLCanvasElement.prototype.toBlob = function () {
      sharedCanvas = this;
    };
    PariciRanking.handleDailyShareImageRuntime({
      result: { success: true, attempts: 1 },
      dailyTargetData: { streetName: "Rue de Rivoli", date: snapshot.date },
      dailyGuessHistory: [{ distance: 0 }],
      dailyLeaderboardRows: snapshot.rows,
      getDailyShareDateLabel: (date) => date,
      formatDailyDistanceForShare: (d) => `${d} m`,
      showMessage: () => {},
    });
    document.body.append(sharedCanvas);
    sharedCanvas.id = "daily-canvas";
    return {
      dayPage,
      weekPage,
      weeklyNames,
      dailyNames: painted
        .filter((p) => p.text.startsWith("Classé "))
        .map((p) => p.text),
      dailyResults: painted.filter((p) => p.x === 960).map((p) => p.text),
      weeklyHeight: weeklyCanvas.height,
      dayHeight: sharedCanvas.height,
    };
  });
  const expected = rows.map((row) => row.username);
  expect(result.weeklyNames).toEqual(expected);
  expect(result.dailyNames).toEqual([]);
  expect(result.dayPage.map((row) => row.name)).toEqual(expected);
  expect(result.weekPage).toEqual(expected);
  expect(result.dailyResults).toEqual([]);
  expect(result.dayHeight).toBe(1350);
  expect(result.weeklyHeight).toBeGreaterThan(2000);
  await page.locator("#weekly-canvas").screenshot({
    path: testInfo.outputPath("parici-daily-weekly-shared.png"),
  });
  await page.locator("#daily-canvas").screenshot({
    path: testInfo.outputPath("parici-daily-result-shared.png"),
  });
});
