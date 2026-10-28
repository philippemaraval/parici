const { test, expect } = require("@playwright/test");
const { expectNumberLayout } = require("./support/assert-number-layout");
test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\//, (r) => r.abort());
});
test("profile groups game summaries before clearly expandable details", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem("camino_auth_token", "e2e-player-token");
    localStorage.setItem(
      "camino_paris_user",
      JSON.stringify({
        id: 1,
        username: "JoueurE2E",
        avatar: "👤",
        authenticated: true,
      }),
    );
  });
  await page.route("**/api/profile", (r) =>
    r.fulfill({
      json: {
        id: 1,
        username: "JoueurE2E",
        avatar: "👤",
        role: "player",
        created_at: "2026-01-01",
        scores: [],
        stats: {},
        daily: { attempts: [], current_streak: 2, max_streak: 3 },
        collect: {
          attempts: 2,
          unique_cards: 1,
          total_copies: 1,
          success_rate: 50,
          active_unique_cards: 1,
          active_card_count: 111,
          progress: 0.9,
          albums: [],
          badges: [],
        },
      },
    }),
  );
  await page.goto("/?view=profile#profile");
  await expect(page.locator(".profile-collect-summary")).toBeVisible();
  const details = page.locator(".profile-analysis");
  await details.locator(":scope>summary").click();
  await expect(details).toHaveAttribute("open", "");
  await expect(page.locator(".profile-kpi-grid")).toBeVisible();
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNumberLayout(page.locator("#profile-panel"));
    await page.screenshot({
      path: `/private/tmp/parici-numbers-profile-${width}.png`,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const positions = await page.evaluate(() => ({
    collect: document
      .querySelector(".profile-collect-summary")
      .getBoundingClientRect().top,
    analysis: document
      .querySelector(".profile-analysis")
      .getBoundingClientRect().top,
    rewards: document.querySelector(".profile-rewards").getBoundingClientRect()
      .top,
  }));
  expect(positions.collect).toBeLessThan(positions.rewards);
  expect(positions.rewards).toBeLessThan(positions.analysis);
  await page
    .locator("#sidebar")
    .evaluate((element) => (element.scrollTop = 500));
  await expect(page.locator("nav.site-nav")).toHaveClass(/is-stuck/);
  const navigationBounds = await page.locator("nav.site-nav").boundingBox();
  expect(navigationBounds.y).toBeGreaterThanOrEqual(0);
  await expect(page.locator(".site-footer__share")).toHaveText(
    "Partager Parici",
  );
});

for (const route of ["/collect.html", "/explorer.html"])
  test(`sticky navigation remains opaque on ${route}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(route);
    await page.evaluate(() => {
      document.body.style.minHeight = "2400px";
      window.scrollTo(0, 700);
    });
    const nav = page.locator("nav.site-nav");
    await expect(nav).toHaveClass(/is-stuck/);
    await expect(nav).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    expect((await nav.boundingBox()).y).toBeGreaterThanOrEqual(0);
  });
