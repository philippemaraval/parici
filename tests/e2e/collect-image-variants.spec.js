const { test, expect } = require("@playwright/test");
const catalog = require("../../data/collect_paris_catalog.json");
const { imageVariants } = require("../../backend/domains/collect/image-urls");
test.use({ deviceScaleFactor: 1, reducedMotion: "reduce" });
test("Collect requests thumbnails in the grid and detailed photographs in the sheet, preserving credits", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() =>
    localStorage.setItem("camino_auth_token", "image-variants-test"),
  );
  await page.route("https://**/*", (r) => r.abort());
  const names = ["Tour Eiffel", "Rue de Bretagne", "Chemin des Israélites"];
  const cards = names.map((name, index) => {
    const c = catalog.records.find((c) => c.name === name);
    return {
      ...c,
      id: index + 1,
      collection_number: index + 1,
      copy_count: 1,
      current_rarity: c.base_rarity,
      copies: [],
      statistics: { attempts: 0 },
      image_attribution: c.illustration,
      ...imageVariants(c.image_reference),
    };
  });
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname,
      match = pathname.match(/\/cards\/(\d+)$/);
    let json = {};
    if (pathname.endsWith("/session")) json = { id: 1, username: "ImagesTest" };
    else if (match) json = cards.find((c) => c.id === Number(match[1]));
    else if (pathname.includes("/collection"))
      json = {
        cards,
        total: cards.length,
        page: 1,
        pageSize: 50,
        summary: { owned: 3, active: 3, copies: 3 },
      };
    else if (pathname.endsWith("/albums")) json = { albums: [], badges: [] };
    else if (pathname.endsWith("/weekly-challenge"))
      json = { personal: { progress: [], score: 0 }, leaderboard: [] };
    else if (pathname.includes("/leaderboard")) json = { players: [] };
    else if (pathname.endsWith("/quota")) json = { copies: 0, limit: 4 };
    await route.fulfill({ json });
  });
  const requested = [];
  page.on("request", (r) => {
    if (r.url().includes("/data/collect_images/")) requested.push(r.url());
  });
  await page.goto("/collect.html?panel=collection");
  for (const card of cards) {
    const tile = page.locator(`#collect-grid [data-card-id="${card.id}"]`);
    await tile.scrollIntoViewIfNeeded();
    const image = tile.locator("img");
    await expect(image).toHaveAttribute("src", card.image_thumbnail);
    await expect(image).toHaveJSProperty("naturalWidth", 320);
    await expect(tile.locator(".collect-card-photo-credit")).toContainText(
      card.illustration.source === "panoramax"
        ? "Panoramax"
        : card.illustration.source === "wikipedia"
          ? "Wikimedia"
          : "Google",
    );
  }
  expect(requested.some((url) => url.endsWith(cards[0].image_reference))).toBe(
    false,
  );
  await page.locator('#collect-grid [data-card-id="1"]').click();
  const dialog = page.getByRole("dialog", { name: "Fiche de la carte" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".collect-card-art img")).toHaveAttribute(
    "src",
    cards[0].image_reference,
  );
  await expect(dialog.locator(".collect-card-art img")).toHaveJSProperty(
    "complete",
    true,
  );
  await expect(dialog.locator(".collect-card-photo-credit")).toBeVisible();
  await dialog.screenshot({
    path: testInfo.outputPath("optimized-monument.png"),
  });
});
