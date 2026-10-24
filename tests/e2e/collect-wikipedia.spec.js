const { test, expect } = require("@playwright/test");
const {
  wikipediaLink,
} = require("../../backend/domains/collect/wikipedia-link");
const catalog = require("../../data/collect_paris_catalog.json");
test.use({ reducedMotion: "reduce", deviceScaleFactor: 1 });

test("Collect place sheets show the checked article and omit unverified names", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() =>
    localStorage.setItem("camino_auth_token", "wiki-test"),
  );
  await page.route("https://fonts.googleapis.com/**", (r) => r.abort());
  const samples = [
    ["monument", "Hôtel de Cluny"],
    ["monument", "Conciergerie"],
    ["district", "Quartier de la Sorbonne"],
    ["street", "Rue de Bretagne"],
  ];
  const cards = samples.map(([family, name], index) => {
    const c = catalog.records.find(
      (c) => c.family === family && c.name === name,
    );
    return {
      id: index + 1,
      name: c.name,
      family: c.family,
      source_entity_id: c.source_entity_id,
      collection_number: c.collection_number,
      copy_count: 1,
      current_rarity: c.base_rarity,
      image_reference: "/apple-touch-icon.png",
      copies: [],
      statistics: { attempts: 0 },
      short_description: c.short_description,
      description_full: c.description_full,
      wikipedia_url: wikipediaLink(c.family, c.source_entity_id),
    };
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const match = path.match(/\/cards\/(\d+)$/);
    let json = {};
    if (path.endsWith("/session")) json = { id: 1, username: "WikiTest" };
    else if (match) json = cards.find((c) => c.id === Number(match[1]));
    else if (path.includes("/collection"))
      json = {
        cards,
        total: cards.length,
        page: 1,
        pageSize: 50,
        summary: { owned: 4, active: 4, copies: 4 },
      };
    else if (path.endsWith("/albums")) json = { albums: [], badges: [] };
    else if (path.includes("/map/"))
      json = { type: "FeatureCollection", features: [] };
    else if (path.endsWith("/quota")) json = { copies: 0, limit: 4 };
    else if (path.endsWith("/weekly-challenge"))
      json = { personal: { progress: [], score: 0 }, leaderboard: [] };
    else if (path.includes("/leaderboard")) json = { players: [] };
    await route.fulfill({ json });
  });
  await page.goto("/collect.html?panel=collection");
  const dialog = page.getByRole("dialog", { name: "Fiche de la carte" });
  for (const card of cards) {
    await page.locator(`#collect-grid [data-card-id="${card.id}"]`).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".collect-tile__name")).toHaveText(card.name);
    const link = dialog.getByRole("link", { name: "Lire l’article Wikipédia" });
    if (card.wikipedia_url) {
      await expect(link).toHaveAttribute("href", card.wikipedia_url);
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", "noopener noreferrer");
      await link.scrollIntoViewIfNeeded();
      await expect(link).toBeVisible();
      if (card.id === 1)
        await testInfo.attach("cluny-checked-article", {
          body: await page.screenshot({
            path: testInfo.outputPath("cluny-wikipedia.png"),
          }),
          contentType: "image/png",
        });
    } else await expect(link).toHaveCount(0);
    await dialog.getByRole("button", { name: "Fermer", exact: true }).click();
    await expect(dialog).not.toBeVisible();
  }
});
