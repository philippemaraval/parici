const { test, expect } = require("@playwright/test");

test("compact albums keep review buttons on one line and show several albums per mobile viewport", async ({
  page,
}, info) => {
  test.setTimeout(60000);
  await page.addInitScript(() =>
    localStorage.setItem("camino_auth_token", "album-density-fixture"),
  );
  await page.route(/^https:\/\//, (route) => route.abort());
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { database: "ready", collectApiVersion: 5 } }),
  );
  const names = [
    "Les palais de la ville",
    "Les peintres dans la ville",
    "Liberté, République, Révolution",
    "Sur les traces des écrivains",
    "Le jardin des noms de rues",
    "Une ville, plusieurs cultes",
  ];
  const albums = names.map((name, i) => ({
    slug: `theme-density-${i}`,
    name,
    description:
      "Une promenade pour découvrir les lieux, les personnalités et les histoires de la ville à travers les cartes de cet album.",
    active_card_count: 30 + i,
    owned_active_card_count: 3,
    earned_active_card_count: 2,
    progress: 10,
  }));
  let goal = null;
  await page.route("**/api/collect/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/goal")) {
      if (route.request().method() === "PUT") {
        const a = albums.find(
          (album) => album.slug === route.request().postDataJSON().slug,
        );
        goal = a ? { ...a, remaining: a.active_card_count - 3 } : null;
      }
      return route.fulfill({ json: { goal } });
    }
    if (path.endsWith("/reviews/counts"))
      return route.fulfill({
        json: {
          revision: 3,
          errors: 1,
          albums: Object.fromEntries(
            albums.map((a, i) => [
              a.slug,
              { revision: 3, errors: i === 1 ? 0 : 1 },
            ]),
          ),
        },
      });
    if (path === "/api/collect/albums")
      return route.fulfill({ json: { albums, badges: [] } });
    if (path.endsWith("/personal-albums"))
      return route.fulfill({
        json: {
          albums: [
            {
              id: 7,
              name: "Mes prochaines promenades",
              total: 12,
              owned: 3,
              earned: 2,
            },
          ],
        },
      });
    if (path.endsWith("/pending"))
      return route.fulfill({ json: { game: null } });
    if (path.endsWith("/quota"))
      return route.fulfill({ json: { copies: 0, limit: 4 } });
    if (path.endsWith("/weekly-challenge"))
      return route.fulfill({
        json: { personal: { progress: [] }, leaderboard: [] },
      });
    if (path.includes("leaderboard")) return route.fulfill({ json: [] });
    return route.fulfill({ json: {} });
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/collect.html?panel=albums&e2eMap=1");
  await page.locator("#collect-album-family").selectOption("thematic");
  const tiles = page.locator("#collect-album-grid > article");
  await expect(tiles).toHaveCount(6);
  await expect(
    tiles.nth(1).locator('[data-review-mode="errors"]'),
  ).toBeDisabled();
  const measurements = [];
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 1440, height: 900 },
    { width: 1440, height: 900, wideFont: true },
  ]) {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await page.reload();
    await page.locator("#collect-album-family").selectOption("thematic");
    await expect(tiles).toHaveCount(6);
    await page.evaluate(() => document.fonts.ready);
    if (viewport.wideFont)
      await page.addStyleTag({
        content:
          ".collect-album-summary, .collect-album-summary * { font-family: Verdana, sans-serif !important; }",
      });
    const layout = await tiles.evaluateAll((nodes) =>
      nodes.map((node) => {
        const buttons = [
          ...node.querySelectorAll(".collect-review-actions button"),
        ];
        const bounds = buttons.map((button) => button.getBoundingClientRect());
        return {
          height: node.getBoundingClientRect().height,
          aligned: Math.abs(bounds[0].top - bounds[1].top) < 1,
          clipped: buttons.some(
            (button) => button.scrollWidth > button.clientWidth,
          ),
          buttonHeight: Math.max(...bounds.map((rect) => rect.height)),
        };
      }),
    );
    for (const tile of layout) {
      expect(tile.aligned).toBe(true);
      expect(tile.clipped, JSON.stringify({ viewport, tile })).toBe(false);
      expect(tile.buttonHeight).toBeLessThanOrEqual(34);
      expect(
        tile.height,
        JSON.stringify({ viewport, tile }),
      ).toBeLessThanOrEqual(200);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .locator("#collect-album-grid")
      .evaluate((node) =>
        window.scrollTo(0, node.getBoundingClientRect().top + scrollY - 72),
      );
    const visible = await tiles.evaluateAll(
      (nodes) =>
        nodes.filter((node) => {
          const r = node.getBoundingClientRect();
          return r.top >= 60 && r.bottom <= innerHeight;
        }).length,
    );
    if (viewport.width === 390) expect(visible).toBeGreaterThanOrEqual(3);
    if (viewport.width === 430) expect(visible).toBeGreaterThanOrEqual(4);
    measurements.push({
      ...viewport,
      visible,
      maxHeight: Math.max(...layout.map((tile) => tile.height)),
    });
    if (viewport.width === 390 || viewport.width === 1440)
      await page.screenshot({
        path: info.outputPath(`albums-${viewport.width}.png`),
      });
  }
  await tiles.first().locator("[data-target-album]").click();
  await expect(tiles.first().locator("[data-target-album]")).toHaveText(
    "Album ciblé",
  );
  expect(goal.slug).toBe(albums[0].slug);
  await page.reload();
  await page.locator("#collect-album-family").selectOption("thematic");
  await expect(tiles.first().locator("[data-target-album]")).toHaveText(
    "Album ciblé",
  );
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ albumDensity: measurements }));
});
