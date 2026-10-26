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
    answers = [];
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
    if (path === "/api/collect/games")
      throw new Error("Review must never request a rewarded game");
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
          personal: { progress: [], score: 0 },
          leaderboard: [],
          startsAt: "2026-10-19",
          endsAt: "2026-10-26",
        },
      });
    return r.fulfill({ json: {} });
  });
  return { calls, answers };
}
async function choose(page, name) {
  await expect(page.locator("#collect-map")).toBeVisible();
  await expect(page.locator("#collect-next")).toBeHidden();
  await page.locator("#collect-map").scrollIntoViewIfNeeded();
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

test("result shows three album changes and opens the targeted personal album", async ({
  page,
}, info) => {
  await setup(page);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/collect/games", (r) =>
    r.fulfill({
      json: {
        gameId: "00000000-0000-4000-8000-000000000001",
        maxAttempts: 1,
        guesses: [],
        quota: { copies: 0, limit: 4 },
        card: {
          family: "street",
          name: "A",
          imageReference: "/apple-touch-icon.png",
        },
      },
    }),
  );
  await page.route(
    "**/api/collect/games/00000000-0000-4000-8000-000000000001/answer",
    (r) =>
      r.fulfill({
        json: {
          correct: true,
          rewardGranted: true,
          ownedCount: 1,
          card: {
            id: 1,
            collectionNumber: 1,
            imageReference: "/apple-touch-icon.png",
            family: "street",
            name: "A",
            sourceEntityId: "A",
            rarity: 2,
            rarityLabel: "Peu commune",
          },
          newBadges: [{ name: "Premiers pas" }],
          progress: {
            kind: "new",
            collection: { before: 4, after: 5, total: 20 },
            otherAlbumCount: 4,
            albums: [
              {
                slug: "personal-7",
                name: "Mes balades",
                targeted: true,
                before: 8,
                after: 9,
                total: 12,
              },
              {
                slug: "streets",
                name: "Toutes les rues",
                before: 2,
                after: 3,
                total: 3,
                complete: true,
              },
              {
                slug: "monuments",
                name: "Patrimoine",
                before: 10,
                after: 11,
                total: 15,
              },
            ],
          },
        },
      }),
  );
  await page.goto("/collect.html?e2eMap=1");
  await page.locator("#collect-next").click();
  await expect(page.locator("#collect-map")).toBeVisible();
  await page.locator("#collect-visual-hint").evaluate((n) => (n.open = false));
  await choose(page, "A");
  const result = page.locator("#collect-result-progress");
  await expect(result).toContainText("Nouvelle carte !");
  const details = result.locator("details");
  await expect(details).not.toHaveAttribute("open", "");
  expect((await result.boundingBox()).height).toBeLessThan(90);
  await result.locator("summary").click();
  await expect(details).toHaveAttribute("open", "");
  await expect(result).toContainText("Peu commune");
  await expect(result).toContainText("4 → 5/20");
  await expect(result).toContainText("8 → 9/12");
  await expect(result).toContainText("Album terminé !");
  await expect(result).toContainText("Premiers pas");
  await expect(result.locator("li")).toHaveCount(3);
  await expect(result).toContainText("Voir les autres albums (+4)");
  await expect(page.locator("#collect-next")).toHaveText("Rejouer");
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await result.locator("summary").click();
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [1440, 900],
  ]) {
    await page.setViewportSize({ width, height });
    await page.locator("#collect-game-controls").evaluate((node) => {
      node.scrollTop = 0;
    });
    const card = page.locator("#collect-revealed-card .collect-card");
    await expect(card).toBeVisible();
    const bounds = await card.boundingBox();
    const controls = await page.locator("#collect-game-controls").boundingBox();
    expect(bounds.y).toBeGreaterThanOrEqual(controls.y);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(
      Math.min(height, controls.y + controls.height),
    );
    expect((await result.boundingBox()).height).toBeLessThan(90);
    expect(
      await card.evaluate((node) => getComputedStyle(node).animationName),
    ).toBe("collect-card-turn");
    await page.screenshot({
      path: info.outputPath(`collect-compact-${width}.png`),
    });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("#collect-revealed-card .collect-card")).toHaveCSS(
    "animation-name",
    "none",
  );
  await page.setViewportSize(
    info.project.name === "mobile-chromium"
      ? { width: 390, height: 844 }
      : { width: 1440, height: 900 },
  );
  await page.screenshot({
    path: info.outputPath("collect-result.png"),
    fullPage: true,
  });
  await result.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(details).toHaveAttribute("open", "");
  await result.getByRole("button", { name: "Ouvrir Mes balades" }).click();
  await expect(page.locator("#personal-album-title")).toHaveText("Mes balades");
  await expect(page.locator("#personal-album-view")).toBeVisible();
  expect(errors).toEqual([]);
});

test("duplicate, fragment, wrong and quota results show only earned progress and reset on replay", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await setup(page);
  let turn = 0;
  const card = {
    id: 1,
    collectionNumber: 1,
    imageReference: "/apple-touch-icon.png",
    family: "street",
    name: "A",
    sourceEntityId: "A",
    rarity: 1,
    rarityLabel: "Commune",
  };
  const results = [
    {
      correct: true,
      rewardGranted: true,
      ownedCount: 3,
      card,
      progress: {
        kind: "duplicate",
        collection: { before: 2, after: 2, total: 3 },
        albums: [],
        otherAlbumCount: 0,
      },
    },
    {
      correct: true,
      rewardGranted: false,
      card,
      fragments: { earned: 1, count: 2, required: 4 },
    },
    { correct: false, rewardGranted: false, card },
    { correct: true, rewardGranted: false, card, rewardBlockedReason: "quota" },
    {
      correct: true,
      rewardGranted: true,
      ownedCount: 1,
      card,
      fragments: { earned: 1, count: 4, required: 4 },
    },
  ];
  await page.route("**/api/collect/games", (r) =>
    r.fulfill({
      json: {
        gameId: "00000000-0000-4000-8000-00000000000" + (turn + 1),
        card: { ...card, imageReference: "/apple-touch-icon.png" },
        maxAttempts: 1,
        guesses: [],
        quota: { copies: 0, limit: 4 },
      },
    }),
  );
  await page.route("**/api/collect/games/*/answer", (r) =>
    r.fulfill({ json: results[turn++] }),
  );
  await page.goto("/collect.html?e2eMap=1");
  for (const text of [
    "Doublon · 3 exemplaires",
    "+1 fragment · 2/4",
    "Un lieu à revoir",
    "Quota atteint",
    "Carte assemblée",
  ]) {
    await page.locator("#collect-next").click();
    await expect(page.locator("#collect-result-progress")).toBeHidden();
    await expect(page.locator("#collect-map")).toBeVisible();
    await page
      .locator("#collect-visual-hint")
      .evaluate((n) => (n.open = false));
    await choose(page, "A");
    await expect(page.locator("#collect-result-progress")).toContainText(text);
    await expect(page.locator("#collect-result-progress li")).toHaveCount(0);
    if (text.startsWith("Doublon"))
      await expect(
        page.locator("#collect-result-progress details"),
      ).not.toHaveAttribute("open", "");
    await expect(page.locator("#collect-next")).toHaveText("Rejouer");
  }
});
