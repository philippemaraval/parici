const { test, expect } = require("@playwright/test");

test("une page ancienne initialise le jeu après le chargement du module", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.legacyShellDomReady = false;
    document.addEventListener("DOMContentLoaded", () => {
      window.legacyShellDomReady = true;
    });
  });
  await page.route(/^https:\/\//, (route) => route.abort());
  await page.route("**/?view=profile", async (route) => {
    const response = await route.fetch();
    const html = (await response.text()).replace(
      /<script type="module" src="\/assets\/main\.[^"]+"[^>]*><\/script>/,
      '<script defer src="/main.js"></script>',
    );
    await route.fulfill({ response, body: html });
  });
  await page.route("**/assets/main.*.js", async (route) => {
    await page.waitForFunction(() => window.legacyShellDomReady === true);
    await route.continue();
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?view=profile");
  await expect(page.locator("body")).toHaveClass(/app-ready/);
  await expect(page.locator("#auth-username")).toBeAttached();
  expect(errors).toEqual([]);
});
