const { test, expect } = require("@playwright/test");
const { expectNumberLayout } = require("./support/assert-number-layout");

test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\//, (route) => route.abort());
});

test("Collect quota preserves countdown zeros and aligns digits with separators", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("camino_auth_token", "quota-fixture"),
  );
  await page.route("**/api/collect/quota", (route) =>
    route.fulfill({
      json: {
        copies: 4,
        limit: 4,
        nextAvailableAt: new Date(Date.now() + 65000).toISOString(),
      },
    }),
  );
  await page.goto("/collect.html");
  const quota = page.locator("#collect-quota");
  await expect.poll(() => quota.textContent()).toMatch(/^4\/4 · \d{2}:\d{2}$/);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNumberLayout(quota);
  }
  // The live timer must keep replacing and enhancing its text every second.
  const before = await quota.innerText();
  await expect.poll(() => quota.innerText()).not.toBe(before);
  await expectNumberLayout(quota);
});

test("Explorer counters align after font scaling, wrapping and repeated updates", async ({
  page,
  isMobile,
}, info) => {
  test.skip(!isMobile, "Explorer requires a phone");
  await page.goto("/explorer.html");
  const score = page.locator("#explorer-score");
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const value of ["95", "100", "0", "08", "99,5", "99.5"]) {
      await score.evaluate((node, value) => {
        node.textContent = value;
      }, value);
      await expectNumberLayout(score);
      await expect(score).toHaveText(value, { useInnerText: true });
    }
    await expectNumberLayout(page.locator(".explorer-status"));
    await page.screenshot({
      path: info.outputPath(
        `camino-numbers-${info.project.name}-explorer-${width}.png`,
      ),
    });
  }
});

test("Collect collection counts stay aligned at every layout width", async ({
  page,
}, info) => {
  await page.addInitScript(() =>
    localStorage.setItem("camino_auth_token", "collection-numbers"),
  );
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    let json = {};
    if (path.includes("/collection"))
      json = {
        cards: [
          {
            id: 1,
            name: "Rue de test",
            family: "street",
            source_entity_id: "Rue de test",
            collection_number: 1,
            current_rarity: 1,
            copy_count: 3,
            image_reference: "/apple-touch-icon.png",
          },
        ],
        summary: { owned: 1, active: 10, copies: 3 },
        total: 1,
        page: 1,
        pageSize: 50,
      };
    else if (path.endsWith("/albums")) json = { albums: [], badges: [] };
    else if (path.endsWith("/weekly-challenge"))
      json = { personal: { progress: [], score: 0 }, leaderboard: [] };
    else if (path.includes("/leaderboard")) json = { players: [] };
    else if (path.endsWith("/quota")) json = { copies: 0, limit: 4 };
    return route.fulfill({ json });
  });
  await page.goto("/collect.html?panel=collection");
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNumberLayout(page.locator("#collect-progress"));
    await page.screenshot({
      path: info.outputPath(
        `parici-collection-numbers-${info.project.name}-${width}.png`,
      ),
    });
  }
});
