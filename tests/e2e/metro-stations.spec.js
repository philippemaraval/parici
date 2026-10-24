const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const catalog = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../../data/paris_metro_stations.geojson"),
    "utf8",
  ),
);
const stationNames = new Set(catalog.features.map((f) => f.properties.name));

async function choose(page, control, value) {
  await page.locator(`#${control}-select-button`).click();
  await page.locator(`#${control}-select-list [data-value="${value}"]`).click();
}

test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\//, (route) => route.abort());
});

for (const gameType of ["classique", "marathon", "chrono"]) {
  test(`metro ${gameType} launches with station targets and selectable map points`, async ({
    page,
  }, testInfo) => {
    await page.goto("/?view=camino&e2eMap=1");
    await expect(page.locator("body")).toHaveClass(/app-ready/);
    await expect(page.locator("#map-status")).toHaveText("Carte OK", {
      timeout: 20000,
    });
    await choose(page, "mode", "stations-metro");
    await choose(page, "game-mode", gameType);
    await page.locator("#restart-btn").click();
    await expect
      .poll(async () =>
        stationNames.has(await page.locator("#target-street").innerText()),
      )
      .toBe(true);
    await expect(page.locator("#target-panel-title-text")).toHaveText(
      "Station à trouver",
    );
    const points = page.locator(
      ".leaflet-marker-pane path.leaflet-interactive",
    );
    await expect.poll(() => points.count()).toBeGreaterThanOrEqual(321);
    await points.first().dispatchEvent("click");
    await expect(page.locator("#skip-btn")).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`metro-${gameType}.png`),
      fullPage: true,
    });
  });
}

test("switching between monuments and stations keeps their catalogues separate, including Lecture", async ({
  page,
}) => {
  await page.goto("/?view=camino&e2eMap=1");
  await expect(page.locator("body")).toHaveClass(/app-ready/);
  await expect(page.locator("#map-status")).toHaveText("Carte OK", {
    timeout: 20000,
  });
  for (const [zone, count] of [
    ["stations-metro", 321],
    ["monuments", null],
    ["stations-metro", 321],
  ]) {
    if (!(await page.locator("#mode-select-button").isVisible())) {
      await page.locator("#lecture-back-btn").click();
    }
    await choose(page, "mode", zone);
    await choose(page, "game-mode", "lecture");
    const search = page.locator("#lecture-search-input");
    if (zone === "stations-metro") {
      await expect(search).toHaveAttribute(
        "placeholder",
        "Rechercher une station de métro",
      );
      const touch = await page.evaluate(
        () => "ontouchstart" in window || navigator.maxTouchPoints > 0,
      );
      await expect
        .poll(() =>
          page.locator(".leaflet-marker-pane path.leaflet-interactive").count(),
        )
        .toBe(count * (touch ? 2 : 1));
    } else {
      await expect(search).toHaveAttribute(
        "placeholder",
        "Rechercher un monument (nom ou mot)",
      );
      await expect
        .poll(() =>
          page.locator(".leaflet-marker-pane path.leaflet-interactive").count(),
        )
        .not.toBe(321);
    }
  }
});

test("authenticated metro game submits only stations and records a station answer", async ({
  page,
}) => {
  const { start } = require("../../backend/domains/game-integrity/sessions");
  let selection;
  let answer;
  await page.addInitScript(() => {
    localStorage.setItem(
      "camino_paris_user",
      JSON.stringify({ id: 1, username: "JoueurE2E", authenticated: true }),
    );
    localStorage.setItem("camino_auth_token", "e2e-player-token");
  });
  await page.route("**/api/game-sessions", async (route) => {
    selection = route.request().postDataJSON();
    const receipt = await start(
      { pool: { query: async () => ({ rows: [] }) } },
      1,
      selection,
    );
    await route.fulfill({ json: receipt });
  });
  await page.route("**/api/game-sessions/*/answers", async (route) => {
    answer = route.request().postDataJSON();
    await route.fulfill({ json: { correct: false, points: 0 } });
  });
  await page.goto("/?view=camino&e2eMap=1");
  await expect(page.locator("#map-status")).toHaveText("Carte OK", {
    timeout: 20000,
  });
  await choose(page, "mode", "stations-metro");
  await page.locator("#restart-btn").click();
  await expect.poll(() => selection?.mode).toBe("stations-metro");
  expect(new Set(selection.availableNames)).toEqual(stationNames);
  await expect
    .poll(async () =>
      stationNames.has(await page.locator("#target-street").innerText()),
    )
    .toBe(true);
  await page
    .locator(".leaflet-marker-pane path.leaflet-interactive")
    .first()
    .dispatchEvent("click");
  await expect.poll(() => answer?.index).toBe(0);
  expect(stationNames.has(answer.answerName)).toBe(true);
});
