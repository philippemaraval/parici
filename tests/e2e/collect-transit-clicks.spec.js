const { test, expect } = require("@playwright/test");
test.use({ serviceWorkers: "block" });
const features = [
  {
    type: "Feature",
    properties: { name: "Transport test", color: "e22122" },
    geometry: {
      type: "LineString",
      coordinates: [
        [2.34, 48.8566],
        [2.37, 48.8566],
      ],
    },
  },
];

test("Collect keeps the line selected and submits it on the second real click", async ({
  page,
  isMobile,
}, testInfo) => {
  await page.route(/^https:\/\//, (route) => route.abort());
  await page.addInitScript(() =>
    localStorage.setItem("camino_auth_token", "test-transit"),
  );
  await page.route("**/assets/leaflet-runtime*.js", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        '\nwindow.L.Map.addInitHook(function(){if(this.getContainer().id==="collect-map")window.collectTestMap=this;});',
    });
  });
  let answer;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let json = {};
    if (url.pathname === "/api/session") json = { id: 1, username: "Test" };
    else if (url.pathname.endsWith("/health"))
      json = { database: "ready", collectApiVersion: 4 };
    else if (url.pathname.endsWith("/quota")) json = { copies: 0, limit: 4 };
    else if (url.pathname.endsWith("/pending")) json = { game: null };
    else if (url.pathname.includes("/map/"))
      json = {
        type: "FeatureCollection",
        features: url.pathname.endsWith("/bus") ? features : [],
      };
    else if (
      url.pathname.endsWith("/games") &&
      route.request().method() === "POST"
    )
      json = {
        gameId: "d30c3b37-2c68-460e-81fa-e4a501301612",
        card: {
          name: "Transport test",
          family: "bus",
          imageReference: "/apple-touch-icon.png",
          currentRarity: 1,
        },
        maxAttempts: 1,
        guesses: [],
        quota: { copies: 0, limit: 4 },
      };
    else if (url.pathname.endsWith("/answer")) {
      answer = route.request().postDataJSON();
      json = { stage: "guess", guesses: [], remainingAttempts: 1 };
    } else if (url.pathname.endsWith("/albums"))
      json = { albums: [], badges: [] };
    else if (url.pathname.endsWith("/weekly-challenge"))
      json = { personal: { progress: [], score: 0 }, leaderboard: [] };
    await route.fulfill({ json });
  });
  await page.goto("/collect.html");
  await expect(page.locator("#collect-auth-gate")).toBeHidden();
  await expect(page.locator("#collect-game-controls")).toBeVisible();
  await expect(page.locator("#collect-next")).toBeEnabled();
  await page.locator("#collect-next").click();
  await expect(page.locator("body")).toHaveClass(/collect-session-active/);
  await page.locator("#collect-visual-hint summary").click();
  await centerVisibleLine(page, "collectTestMap");
  const position = await page.evaluate(() => {
    const map = window.collectTestMap;
    const rect = map.getContainer().getBoundingClientRect();
    const p = map.latLngToContainerPoint([48.8566, 2.355]);
    return { x: rect.left + p.x, y: rect.top + p.y };
  });
  const click = () =>
    isMobile
      ? page.touchscreen.tap(position.x, position.y)
      : page.mouse.click(position.x, position.y);
  await click();
  expect(answer).toBeUndefined();
  await page.screenshot({
    path: testInfo.outputPath("collect-selected-transit.png"),
    fullPage: true,
  });
  await click();
  await expect.poll(() => answer?.answerEntityId).toBe("Transport test");
});

test("Parici transport zone accepts a real click beside the thin visible stroke", async ({
  page,
  isMobile,
}) => {
  await page.route(/^https:\/\//, (route) => route.abort());
  await page.route("**/assets/leaflet-runtime*.js", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        '\nwindow.L.Map.addInitHook(function(){if(this.getContainer().id==="map")window.transportTestMap=this;});',
    });
  });
  await page.route("**/data/paris_transit_lines.geojson*", (route) =>
    route.fulfill({ json: { type: "FeatureCollection", features } }),
  );
  await page.goto("/?view=camino&e2eMap=1");
  await expect(page.locator("#map-status")).toHaveText("Carte OK", {
    timeout: 20000,
  });
  await page.locator("#mode-select-button").click();
  await page
    .locator('#mode-select-list [data-value="lignes-transports-idf"]')
    .click();
  await page.locator("#restart-btn").click();
  await expect(page.locator("#target-street")).toHaveText("Transport test");
  await centerVisibleLine(page, "transportTestMap");
  const position = await page.evaluate(() => {
    const map = window.transportTestMap;
    const rect = map.getContainer().getBoundingClientRect();
    const p = map.latLngToContainerPoint([48.8566, 2.355]);
    return { x: rect.left + p.x, y: rect.top + p.y + 6 };
  });
  if (isMobile) await page.touchscreen.tap(position.x, position.y);
  else await page.mouse.click(position.x, position.y);
  await expect(page.locator("#summary .summary-item")).toContainText(
    "Transport test – Correct",
  );
});

async function centerVisibleLine(page, name) {
  await page.evaluate(async (name) => {
    const map = window[name];
    map.invalidateSize({ animate: false });
    map.setView([48.8566, 2.355], 14, { animate: false });
    const rect = map.getContainer().getBoundingClientRect();
    const point = map.latLngToContainerPoint([48.8566, 2.355]);
    map.panBy(
      [
        rect.left + point.x - innerWidth / 2,
        rect.top + point.y - innerHeight * 0.7,
      ],
      { animate: false },
    );
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  }, name);
}
