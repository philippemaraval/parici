const { test, expect } = require("@playwright/test");
test("unowned cards retain their name and number, including search and fragments", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() =>
    localStorage.setItem("camino_auth_token", "collection-test"),
  );
  const cards = [
    {
      id: 1,
      name: "Rue de Bretagne",
      family: "street",
      collection_number: 42,
      copy_count: 0,
      current_rarity: 2,
    },
    {
      id: 2,
      name: "Avenue des Champs-Élysées",
      family: "street",
      collection_number: 43,
      copy_count: 0,
      current_rarity: 5,
      fragments_enabled: true,
      fragments_required: 3,
      fragment_count: 1,
    },
  ];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let json = {};
    if (url.pathname.endsWith("/session")) json = { id: 1, username: "Test" };
    else if (url.pathname.includes("/collection")) {
      const q =
        url.searchParams.get("search") || url.searchParams.get("q") || "";
      const filtered = cards.filter(
        (c) => !q || c.name.toLowerCase().includes(q.toLowerCase()),
      );
      json = {
        cards: filtered,
        total: filtered.length,
        page: 1,
        pageSize: 50,
        summary: { owned: 0, active: 2, copies: 0 },
      };
    } else if (url.pathname.endsWith("/albums"))
      json = { albums: [], badges: [] };
    else if (url.pathname.endsWith("/weekly-challenge"))
      json = { personal: { progress: [], score: 0 }, leaderboard: [] };
    else if (url.pathname.includes("/leaderboard")) json = { players: [] };
    else if (url.pathname.endsWith("/quota")) json = { copies: 0, limit: 4 };
    await route.fulfill({ json });
  });
  await page.goto("/collect.html?panel=collection");
  await page.locator("#collect-filter-owned").selectOption("");
  const hidden = page.locator(".collect-tile--hidden");
  await expect(hidden).toContainText("Rue de Bretagne");
  await expect(hidden).toContainText("R-0042");
  await expect(hidden.locator("img")).toHaveCount(0);
  await expect(page.locator(".collect-tile--fragments")).toContainText(
    "Avenue des Champs-Élysées",
  );
  await expect(page.locator(".collect-tile--fragments")).toContainText(
    "1/3 fragments",
  );
  await testInfo.attach("collection-undiscovered", {
    body: await page.locator("#collect-grid").screenshot({
      path: testInfo.outputPath("collection-undiscovered.png"),
    }),
    contentType: "image/png",
  });
  await page.locator("#collect-search").fill("Bretagne");
  await expect(page.locator("#collect-grid > article")).toHaveCount(1);
  await expect(hidden).toContainText("Rue de Bretagne");
});
