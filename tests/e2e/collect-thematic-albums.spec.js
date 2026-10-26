const { test, expect } = require("@playwright/test");
const {
  albums: definitions,
} = require("../../data/collect_thematic_albums.json");

test("the 30 Paris thematic albums can be browsed, targeted and mapped on desktop and mobile", async ({
  page,
}, info) => {
  await page.addInitScript(() =>
    localStorage.setItem("camino_auth_token", "thematic-fixture"),
  );
  await page.route(/^https:\/\//, (r) => r.abort());
  await page.route("**/api/health", (r) =>
    r.fulfill({ json: { database: "ready", collectApiVersion: 5 } }),
  );
  const albums = definitions.map((a) => ({
    ...a,
    active_card_count: a.cards.length,
    owned_active_card_count: 1,
    progress: 100 / a.cards.length,
  }));
  const museum = albums[0];
  const cards = [
    museum.cards.find((c) => c.family === "street"),
    museum.cards.find((c) => c.family === "monument"),
  ].map((c, i) => ({ family: c.family, name: c.entity, owned: i === 0 }));
  let goal = null;
  const mapped = [];
  await page.route("**/api/collect/**", async (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path.endsWith("/goal")) {
      if (r.request().method() === "PUT") {
        const album = albums.find(
          (a) => a.slug === r.request().postDataJSON().slug,
        );
        goal = album
          ? { ...album, remaining: album.active_card_count - 1 }
          : null;
      }
      return r.fulfill({ json: { goal } });
    }
    if (path === "/api/collect/albums")
      return r.fulfill({ json: { albums: [...albums].reverse(), badges: [] } });
    if (path === "/api/collect/reviews/counts")
      return r.fulfill({
        json: {
          revision: 1,
          errors: 1,
          albums: Object.fromEntries(
            albums.map((a) => [a.slug, { revision: 1, errors: 1 }]),
          ),
        },
      });
    if (path.endsWith(`/albums/${museum.slug}/cards`))
      return r.fulfill({ json: { cards } });
    if (path.includes("/map/")) {
      await page.evaluate(() => {
        if (window.thematicMapHook) return;
        window.thematicMapHook = true;
        const original = window.L.geoJSON;
        window.L.geoJSON = (...args) => {
          const layer = original(...args);
          window.thematicMapLayer = layer;
          return layer;
        };
      });
      const family = path.split("/").at(-1);
      mapped.push(family);
      const card = cards.find((c) => c.family === family);
      return r.fulfill({
        json: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: { name: card.name, collect_entity_id: card.name },
              geometry:
                family === "street"
                  ? {
                      type: "LineString",
                      coordinates: [
                        [2.35, 48.85],
                        [2.36, 48.85],
                      ],
                    }
                  : { type: "Point", coordinates: [2.355, 48.855] },
            },
          ],
        },
      });
    }
    if (path.endsWith("/personal-albums"))
      return r.fulfill({ json: { albums: [] } });
    if (path.endsWith("/quota"))
      return r.fulfill({ json: { copies: 0, limit: 4 } });
    if (path.endsWith("/pending")) return r.fulfill({ json: { game: null } });
    if (path.endsWith("/weekly-challenge"))
      return r.fulfill({
        json: { personal: { progress: [] }, leaderboard: [] },
      });
    if (path.includes("leaderboard")) return r.fulfill({ json: [] });
    return r.fulfill({ json: {} });
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/collect.html?panel=albums&e2eMap=1");
  await page.locator("#collect-album-family").selectOption("thematic");
  const tiles = page.locator("#collect-album-grid > article");
  await expect(tiles).toHaveCount(30);
  await expect(tiles.first().locator("strong")).toHaveText(definitions[0].name);
  await expect(tiles.last().locator("strong")).toHaveText(
    definitions.at(-1).name,
  );
  const counts = await tiles
    .locator("[data-album]")
    .evaluateAll((nodes) => nodes.map((n) => n.dataset.album));
  expect(counts).toEqual(
    [...albums]
      .sort(
        (a, b) =>
          a.active_card_count - b.active_card_count ||
          a.name.localeCompare(b.name, "fr"),
      )
      .map((a) => a.slug),
  );
  await expect(tiles.first().locator(".collect-album-description")).toHaveText(
    museum.description,
  );
  for (const mode of ["revision", "errors"])
    await expect(
      tiles.first().locator(`[data-review-mode="${mode}"]`),
    ).toBeEnabled();
  await tiles.first().locator("[data-target-album]").click();
  await expect(tiles.first().locator("[data-target-album]")).toHaveText(
    "Album ciblé",
  );
  await expect(page.locator("#collect-target-summary")).toContainText("20 %");
  expect(goal.slug).toBe(museum.slug);
  await tiles.first().locator("[data-album]").click();
  await expect(page.locator("#collect-album-title")).toHaveText(museum.name);
  await expect(page.locator("#collect-album-map-note")).toContainText(
    "1 / 2 lieux possédés",
  );
  expect(mapped.sort()).toEqual(["monument", "street"]);
  expect(
    await page.evaluate(() =>
      window.thematicMapLayer.getLayers().map((layer) => ({
        name: layer.feature.properties.name,
        owned: layer.feature.properties.collect_owned,
      })),
    ),
  ).toEqual(cards.map((c) => ({ name: c.name, owned: c.owned })).reverse());
  await expect(page.locator("#collect-album-map canvas")).toBeVisible();
  await page.locator("#collect-album-close").click();
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(tiles.first().locator("[data-target-album]")).toBeVisible();
  }
  await page.setViewportSize(
    info.project.name === "mobile-chromium"
      ? { width: 390, height: 844 }
      : { width: 1440, height: 1000 },
  );
  await tiles.first().scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath("collect-themes.png"),
    fullPage: false,
  });
  await page.reload();
  await page.locator("#collect-album-family").selectOption("thematic");
  await expect(tiles.first().locator("[data-target-album]")).toHaveText(
    "Album ciblé",
  );
  expect(errors).toEqual([]);
});
