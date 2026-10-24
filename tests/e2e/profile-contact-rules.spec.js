const { test, expect } = require("@playwright/test");
test.use({ deviceScaleFactor: 1, reducedMotion: "reduce" });
test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\//, (route) => route.abort());
});
async function authenticated(page) {
  await page.addInitScript(() => {
    localStorage.setItem("camino_auth_token", "profile-test");
    localStorage.setItem(
      "camino_paris_user",
      JSON.stringify({ id: 1, username: "Nom & test", authenticated: true }),
    );
  });
}
test("the main profile shows actual Collect progress without making a private collection public", async ({
  page,
}, testInfo) => {
  await authenticated(page);
  let visibility = "private";
  await page.route("**/api/profile", (route) =>
    route.fulfill({
      json: {
        id: 1,
        username: "Nom & test",
        avatar: "👤",
        overall: { total_games: 0 },
        daily: { total_days: 0, successes: 0 },
        modes: [],
        quartier_stats: [],
        collect: {
          unique_cards: 5,
          total_copies: 8,
          active_unique_cards: 3,
          active_card_count: 10,
          progress: 30,
          attempts: 0,
          success_rate: null,
          albums: [{ complete: true }],
          badges: [{ earned: true }],
          visibility,
        },
      },
    }),
  );
  await page.goto("/?view=profile#profile");
  await page.locator("#user-panel-details").evaluate((el) => {
    el.open = true;
  });
  const summary = page.getByRole("region", {
    name: "Votre collection Collect",
  });
  await expect(summary).toContainText("3 / 10 cartes actives · 30 %");
  await expect(summary).toContainText("2 cartes archivées conservées");
  await expect(summary).toContainText("0 parties");
  await expect(summary).toContainText("—");
  await expect(summary).toContainText("1 album complet · 1 badge obtenu");
  await expect(summary).toContainText("Collection privée");
  await expect(
    summary.getByRole("link", { name: "Voir mon profil public Collect" }),
  ).toHaveCount(0);
  await expect(
    summary.getByRole("link", { name: "Voir ma collection" }),
  ).toHaveAttribute("href", "/collect.html?panel=collection");
  await testInfo.attach("collect-profile", {
    body: await summary.screenshot({
      path: testInfo.outputPath("collect-profile.png"),
    }),
    contentType: "image/png",
  });
  visibility = "public";
  await page.reload();
  await page.locator("#user-panel-details").evaluate((el) => {
    el.open = true;
  });
  await expect(
    summary.getByRole("link", { name: "Voir mon profil public Collect" }),
  ).toHaveAttribute("href", "/collect.html?profile=Nom%20%26%20test");
});
test("common contact sends Collect and Explorer with the selected domain", async ({
  page,
}) => {
  await authenticated(page);
  const sent = [];
  await page.route("**/api/site/reports", async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({
      status: 201,
      json: { reported: true, id: sent.length },
    });
  });
  await page.goto("/?view=home");
  await page.locator("#site-menu-toggle").click();
  await page.getByRole("button", { name: "Contact", exact: true }).click();
  const form = page.locator("#site-report-form");
  for (const domain of ["collect", "explorer"]) {
    await form.locator('[name="domain"]').selectOption(domain);
    await form
      .locator('[name="detail"]')
      .fill("Le mode " + domain + " rencontre un problème de navigation.");
    await form.getByRole("button", { name: "Envoyer le signalement" }).click();
    await expect(page.locator("#site-report-feedback")).toHaveText(
      "Signalement enregistré. Merci !",
    );
    await expect.poll(() => sent.length).toBe(domain === "collect" ? 1 : 2);
  }
  expect(sent.map((s) => s.domain)).toEqual(["collect", "explorer"]);
});
test("common rules use the effective quota and reveal only published modes", async ({
  page,
}, testInfo) => {
  let modes = {
    collect: true,
    explorer: false,
    collectRules: { quota: { copies: 3, windowMinutes: 17 } },
  };
  await page.route("**/api/site/modes", (route) =>
    route.fulfill({ json: modes }),
  );
  await page.goto("/regles.html#collect");
  await expect(page.locator("#collect")).toBeVisible();
  await expect(page.locator("#collect-rules-quota")).toHaveText(
    "3 cartes sur une période glissante de 17 minutes",
  );
  await expect(page.locator("#explorer")).toBeHidden();
  await expect(page.locator('a[href="#explorer"]')).toBeHidden();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await testInfo.attach("collect-rules", {
    body: await page.screenshot({
      path: testInfo.outputPath("collect-rules.png"),
    }),
    contentType: "image/png",
  });
  modes = { collect: false, explorer: true };
  await page.goto("/regles.html?future=1#explorer");
  await expect(page.locator("#explorer")).toBeVisible();
  await expect(page.locator("#collect")).toBeHidden();
});
