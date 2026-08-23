const { expect, test } = require("@playwright/test");

test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\//, (route) => route.abort());
});

test("accueil mobile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  await page.goto("/");
  await expect(page.locator("body")).toHaveClass(/app-ready/);
  await expect(page.locator(".site-header")).toBeVisible();
  await expect(page.locator(".mobile-mode-card--daily")).toBeVisible();
  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth + 1);
  await testInfo.attach("home-mobile", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});

test("administration desktop", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium");
  await page.goto("/admin/");
  await expect(page.locator(".admin-topbar")).toBeVisible();
  await expect(page.locator("#login-section")).toBeVisible();
  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    loginWidth: document
      .querySelector("#login-section")
      ?.getBoundingClientRect().width,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
  expect(layout.loginWidth).toBeGreaterThan(320);
  await testInfo.attach("admin-login-desktop", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});
