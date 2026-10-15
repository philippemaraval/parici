const { test, expect } = require("@playwright/test");

test("friends can compose a multi-card exchange with quantities", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("camino_auth_token", "social-ui-test"),
  );
  await page.route("https://fonts.googleapis.com/**", (r) => r.abort());
  let sentOffer = null;
  const inventory = (owner) => ({
    total: 2,
    cards: [1, 2].map((id) => ({
      id: String(id),
      name: id === 1 ? "Rue Cler" : "Rue de Bretagne",
      family: "street",
      rarity: 2,
      count: 2,
      copies: [1, 2].map((n) => ({
        id: `${owner}${id}${n}`,
        source: "collect",
        locked: false,
      })),
    })),
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let json = {};
    if (path.endsWith("/session"))
      json = { id: 1, username: "Test", avatar: "👤" };
    else if (path.endsWith("/v2/config")) json = { enabled: true };
    else if (path.endsWith("/v2/me")) json = { userId: "1" };
    else if (path.endsWith("/v2/friends"))
      json = [{ id: "2", username: "Ami", state: "accepted", visible: true }];
    else if (path.endsWith("/v2/activity") || path.endsWith("/v2/blocks"))
      json = [];
    else if (path.includes("/v2/inventory/"))
      json = inventory(path.includes("/inventory/1") ? "1" : "2");
    else if (path.endsWith("/v2/offers") && route.request().method() === "POST")
      sentOffer = route.request().postDataJSON();
    else if (path.endsWith("/albums")) json = { albums: [], badges: [] };
    else if (path.includes("/collection"))
      json = {
        cards: [],
        rarityLabels: {
          1: "Commune",
          2: "Peu commune",
          3: "Rare",
          4: "Épique",
          5: "Légendaire",
        },
        total: 0,
        page: 1,
        pageSize: 50,
        summary: { owned: 0, active: 0, copies: 0 },
      };
    else if (path.endsWith("/weekly-challenge"))
      json = { personal: { progress: [], score: 0 }, leaderboard: [] };
    else if (path.endsWith("/games/pending")) json = { game: null };
    else if (path.endsWith("/goal")) json = { goal: null };
    else if (path.includes("/leaderboard")) json = { players: [] };
    else if (path.endsWith("/quota")) json = { copies: 0, limit: 4 };
    else if (path.endsWith("/settings")) json = {};
    await route.fulfill({ json });
  });
  await page.goto("/collect.html?panel=social");
  await expect(page.locator("#collect-social-space")).toBeVisible();
  await expect(page.locator(".collect-social-list")).toHaveCSS(
    "display",
    "grid",
  );
  const loadedUrls = await page.evaluate(() =>
    performance.getEntriesByType("resource").map((r) => r.name),
  );
  expect(
    loadedUrls.some((url) =>
      /assets\/collect-social\.[a-f0-9]+\.css/.test(url),
    ),
  ).toBe(true);
  expect(loadedUrls.some((url) => url.includes("20261008-v2"))).toBe(false);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  }
  await page.setViewportSize(test.info().project.use.viewport);
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await page.screenshot({
    path: test.info().outputPath("friends.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Échanger", exact: true }).click();
  const dialog = page.locator("dialog.collect-social-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("#social-send-offer")).toBeDisabled();
  const give = dialog.locator('[data-picker-list="give"]');
  const receive = dialog.locator('[data-picker-list="receive"]');
  await give.locator('[data-pick-card="1"]').fill("2");
  await give.locator('[data-pick-card="1"]').dispatchEvent("change");
  await give.locator('[data-pick-card="2"]').fill("1");
  await give.locator('[data-pick-card="2"]').dispatchEvent("change");
  const receiveStep = dialog.locator('[data-compose-side="receive"]');
  if (await receiveStep.isVisible()) await receiveStep.click();
  await receive.locator('[data-pick-card="2"]').fill("1");
  await receive.locator('[data-pick-card="2"]').dispatchEvent("change");
  await expect(dialog.locator("#social-composer-summary")).toContainText(
    "3 proposés",
  );
  await expect(dialog.locator("#social-composer-summary")).toContainText(
    "Rue Cler",
  );
  expect(
    await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  await page.screenshot({
    path: `/private/tmp/parici-social-${test.info().project.name}.png`,
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Examiner la proposition" }).click();
  await expect(dialog.locator("#social-offer-review")).toContainText(
    "Dernier exemplaire",
  );
  await dialog
    .getByRole("button", { name: "Envoyer la proposition", exact: true })
    .click();
  expect(sentOffer.offeredIds).toEqual(["111", "112", "121"]);
  expect(sentOffer.requestedIds).toEqual(["221"]);
});
