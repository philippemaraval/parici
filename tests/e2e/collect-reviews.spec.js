const { test, expect } = require("@playwright/test");
async function setup(page, { errors = 1 } = {}) {
  await page.addInitScript(() =>
    localStorage.setItem("camino_auth_token", "review-fixture"),
  );
  await page.route(/^https:\/\//, (r) => r.abort());
  await page.route("**/api/health", (r) =>
    r.fulfill({ json: { database: "ready", collectApiVersion: 5 } }),
  );
  const calls = [],
    answers = [],
    rewardedCalls = [];
  let position = 1,
    mode = "revision",
    scope = "",
    correct = 0,
    wrong = 0;
  const names = ["A", "C"];
  const review = () => ({
    sessionId: "session-1",
    mode,
    scope,
    total: 2,
    position,
    answered: answers.length,
    correct,
    errors: wrong,
  });
  const game = () => ({
    gameId: "review-" + position,
    maxAttempts: 1,
    review: review(),
    card: {
      family: "street",
      name: names[position - 1],
      imageReference: "/apple-touch-icon.png",
    },
  });
  await page.route("**/api/collect/**", async (r) => {
    const req = r.request(),
      url = new URL(req.url()),
      path = url.pathname;
    if (path === "/api/collect/reviews/counts")
      return r.fulfill({
        json: {
          revision: 2,
          errors,
          albums: {
            streets: { revision: 2, errors },
            "personal-7": { revision: 1, errors },
          },
        },
      });
    if (path === "/api/collect/reviews") {
      const b = req.postDataJSON();
      calls.push(b);
      mode = b.mode;
      scope = b.scope;
      return r.fulfill({ json: game() });
    }
    if (path === "/api/collect/reviews/session-1/next") {
      position++;
      return r.fulfill({
        json:
          position > 2
            ? {
                complete: true,
                review: { ...review(), remainingErrors: wrong },
              }
            : game(),
      });
    }
    if (path.includes("/api/collect/reviews/games/")) {
      const answer = req.postDataJSON().answerEntityId,
        ok = answer === names[position - 1];
      answers.push(answer);
      if (ok) correct++;
      else wrong++;
      return r.fulfill({
        json: {
          correct: ok,
          rewardGranted: false,
          rewardAvailable: false,
          rewardBlockedReason: "review",
          review: review(),
          maxAttempts: 1,
          guesses: [
            { answerEntityId: answer, answerName: answer, correct: ok },
          ],
          card: {
            family: "street",
            name: names[position - 1],
            sourceEntityId: names[position - 1],
            rarity: 1,
          },
        },
      });
    }
    if (
      (path.startsWith("/api/collect/games") && !path.endsWith("/pending")) ||
      path === "/api/collect/events"
    ) {
      rewardedCalls.push(req.method() + " " + path);
      return r.fulfill({
        status: 500,
        json: { error: "Unexpected rewarded-game request" },
      });
    }
    if (path === "/api/collect/map/street") {
      await page.waitForFunction(() => Boolean(window.L?.geoJSON));
      await page.evaluate(() => {
        if (window.reviewMapHook) return;
        window.reviewMapHook = true;
        const original = window.L.geoJSON;
        window.L.geoJSON = (...args) => {
          const layer = original(...args);
          window.reviewTestLayer = layer;
          return layer;
        };
      });
      return r.fulfill({
        json: {
          type: "FeatureCollection",
          features: ["A", "B", "C"].map((name, i) => ({
            type: "Feature",
            properties: { name, collect_entity_id: name },
            geometry: {
              type: "LineString",
              coordinates: [
                [2.334 + i * 0.014, 48.8566],
                [2.335 + i * 0.014, 48.8566],
              ],
            },
          })),
        },
      });
    }
    if (path === "/api/collect/albums")
      return r.fulfill({
        json: {
          albums: [
            {
              slug: "streets",
              name: "Toutes les rues",
              owned_active_card_count: 2,
              active_card_count: 3,
              progress: 66,
            },
          ],
          badges: [],
        },
      });
    if (path === "/api/collect/personal-albums")
      return r.fulfill({
        json: { albums: [{ id: 7, name: "Mes balades", total: 2, owned: 1 }] },
      });
    if (path === "/api/collect/personal-albums/7/cards")
      return r.fulfill({
        json: { album: { id: 7, name: "Mes balades" }, cards: [], total: 0 },
      });
    if (path.includes("/collection/page"))
      return r.fulfill({
        json: {
          cards: [],
          summary: { owned: 2, active: 3, copies: 2 },
          total: 0,
          page: 1,
          pageSize: 50,
        },
      });
    if (path.endsWith("/pending")) return r.fulfill({ json: { game: null } });
    if (path.endsWith("/quota"))
      return r.fulfill({ json: { copies: 2, limit: 4 } });
    if (path.endsWith("/goal")) return r.fulfill({ json: { goal: null } });
    if (path.includes("/leaderboard")) return r.fulfill({ json: [] });
    if (path.endsWith("/weekly-challenge"))
      return r.fulfill({
        json: {
          personal: { progress: [] },
          leaderboard: [],
          startsAt: "2026-10-19",
          endsAt: "2026-10-26",
        },
      });
    return r.fulfill({ json: {} });
  });
  return { calls, answers, rewardedCalls };
}
async function choose(page, name) {
  await expect(page.locator("#collect-map")).toBeVisible();
  const point = await page.evaluate((name) => {
    const l = window.reviewTestLayer
      .getLayers()
      .find((l) => l.feature.properties.name === name);
    return l._map.latLngToContainerPoint(l.getBounds().getCenter());
  }, name);
  const box = await page.locator("#collect-map").boundingBox();
  await page.mouse.click(box.x + point.x, box.y + point.y);
  await page.mouse.click(box.x + point.x, box.y + point.y);
}

test("revision plays obtained cards, shows corrections and ends with a reward-free summary", async ({
  page,
}, info) => {
  const state = await setup(page);
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto("/collect.html?panel=collection&e2eMap=1");
  await page
    .locator('#collect-collection-review [data-review-mode="revision"]')
    .click();
  await expect(page.locator("#collect-review-progress")).toContainText(
    "Carte 1/2",
  );
  await expect(page.locator("#collect-review-progress")).toContainText(
    "Sans carte ni fragment",
  );
  await choose(page, "B");
  await expect(page.locator("#collect-game-status")).toHaveText(
    "Placement à revoir",
  );
  await expect(page.locator("#collect-map-hint")).toContainText(
    "bonne position",
  );
  expect(
    await page.evaluate(
      () =>
        window.reviewTestLayer
          .getLayers()
          .find((l) => l.feature.properties.name === "A").options.color,
    ),
  ).toBe("#1f9d66");
  await page.locator("#collect-next").click();
  await expect(page.locator("#collect-review-progress")).toContainText(
    "Carte 2/2",
  );
  await choose(page, "C");
  await expect(page.locator("#collect-game-status")).toHaveText(
    "Révision réussie",
  );
  await page.locator("#collect-next").click();
  await expect(page.locator("#collect-review-end")).toBeVisible();
  await expect(page.locator("#collect-review-summary")).toContainText(
    "1/2 bonnes réponses",
  );
  await expect(page.locator("#collect-review-summary")).toContainText(
    "Aucune carte ni aucun fragment gagné",
  );
  await page.screenshot({
    path: info.outputPath("collect-review-summary.png"),
    fullPage: true,
  });
  await page.locator("#collect-review-return").click();
  await expect(page.locator("#collect-collection")).toBeVisible();
  expect(state.calls).toEqual([{ mode: "revision", scope: "" }]);
  expect(state.answers).toEqual(["B", "C"]);
  expect(state.rewardedCalls).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("errors and personal album buttons use the selected perimeter", async ({
  page,
}) => {
  const state = await setup(page);
  await page.goto("/collect.html?panel=albums&e2eMap=1");
  await page
    .locator('#collect-album-grid [data-review-mode="errors"]')
    .first()
    .click();
  await expect(page.locator("#collect-review-progress")).toContainText(
    "Revoir mes erreurs",
  );
  await page.locator("#collect-exit").click();
  await page.locator('[data-panel="albums"]').click();
  await page.locator('[data-personal-album="7"]').click();
  await page
    .locator('#personal-album-target [data-review-mode="revision"]')
    .click();
  await expect(page.locator("#collect-review-progress")).toContainText(
    "Réviser mes cartes",
  );
  expect(state.calls).toEqual([
    { mode: "errors", scope: "streets" },
    { mode: "revision", scope: "personal-7" },
  ]);
  expect(state.rewardedCalls).toEqual([]);
});

test("no errors state stays visible and layouts fit small screens", async ({
  page,
}, info) => {
  await setup(page, { errors: 0 });
  await page.goto("/collect.html?panel=albums&e2eMap=1");
  const button = page
    .locator('#collect-album-grid [data-review-mode="errors"]')
    .first();
  await expect(button).toHaveText("Aucune erreur à revoir");
  await expect(button).toBeDisabled();
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await page
        .locator(".collect-album-summary button")
        .evaluateAll((buttons) =>
          buttons.every((b) => b.scrollWidth <= b.clientWidth),
        ),
    ).toBe(true);
  }
  if (info.project.name === "mobile-chromium")
    await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: info.outputPath("collect-review-albums.png"),
    fullPage: true,
  });
});
