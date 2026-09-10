const { expect, test } = require("@playwright/test");

test.beforeEach(async ({ page }) => {
  await page.route("https://**", (route) => route.abort());
});

test("accueil compact, illustrations et commandes cohérentes sans signature", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("/");
  await expect(page.locator(".mobile-mode-card__icon img")).toHaveCount(2);
  await expect(page.locator(".mobile-mode-card--camino img")).toHaveAttribute(
    "src",
    /home-route.svg$/,
  );
  await expect(page.locator("#sound-toggle svg")).toHaveCount(1);
  await page.locator("#sound-toggle").click();
  await expect(page.locator("#sound-toggle")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  expect(
    await page
      .locator(".mobile-home__intro")
      .evaluate((el) => getComputedStyle(el, "::after").content),
  ).toBe("none");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(page.locator(".site-footer__credit")).toHaveCSS(
    "white-space",
    "normal",
  );
  await page.screenshot({
    path: "/tmp/parici-design-home.png",
    fullPage: true,
  });
});

test("profil, récompenses et carte parisienne interactive", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/profile", (route) =>
    route.fulfill({
      json: {
        username: "JoueurE2E",
        avatar: "🚀",
        memberSince: "2026-08-01",
        overall: { total_games: 12, best_score: 120, avg_score: 60 },
        daily: {
          total_days: 5,
          successes: 4,
          avg_attempts: 3,
          current_streak: 2,
          max_streak: 4,
        },
        modes: [],
        arrondissement_stats: [
          {
            arrondissement_name: "Quartier du Bel-Air",
            games_played: 4,
            success_rate: 75,
          },
        ],
      },
    }),
  );
  await page.goto("/?view=profile");
  await page.locator("#auth-username").fill("JoueurE2E");
  await page.locator("#auth-password").fill("mot-de-passe-solide");
  await page.locator("#login-btn").click();
  await expect(page.locator(".profile-name")).toHaveText("JoueurE2E");
  await expect(page.locator(".profile-stats-grid .profile-stat")).toHaveCount(
    3,
  );
  await expect(page.locator(".profile-avatar img")).toHaveAttribute(
    "src",
    /rocket.svg$/,
  );
  await expect(page.locator(".profile-reward-preview")).toBeVisible();
  await page.getByRole("button", { name: "Changer d’avatar" }).click();
  await expect(page.locator("#avatar-grid img").first()).toBeVisible();
  await page.locator("#avatar-modal-close").click();
  await page.getByText("Statistiques et progression", { exact: true }).click();
  await page
    .getByText("Votre aisance par arrondissement", { exact: true })
    .click();
  await expect(page.locator(".profile-heatmap path")).toHaveCount(20);
  const area = page.locator(
    '.profile-heatmap path[aria-label^="12e arrondissement :"]',
  );
  await expect(area).toHaveAttribute("fill", "#33865b");
  await area.focus();
  await area.press("Enter");
  await expect(page.locator(".profile-heatmap-info")).toContainText("75.0 %");
  await page.screenshot({
    path: "/tmp/parici-design-profile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  await page.locator("#logout-btn").click();
  await expect(page.locator("#auth-username")).toBeVisible();
});

test("classement illustré, joueur surligné et export PNG", async ({ page }) => {
  await page.route("**/api/daily/leaderboard/weekly", (route) =>
    route.fulfill({
      json: {
        weekStart: "2026-09-07",
        weekEnd: "2026-09-13",
        rows: [
          {
            username: "JoueurE2E",
            avatar: "🚀",
            successes: 2,
            total_attempts: 5,
            days_played: 2,
            total_distance_meters: 120,
          },
        ],
      },
    }),
  );
  await page.addInitScript(() => {
    localStorage.setItem(
      "camino_paris_user",
      JSON.stringify({ id: 1, username: "JoueurE2E", authenticated: true }),
    );
    localStorage.setItem("camino_auth_token", "e2e-player-token");
    Object.defineProperty(navigator, "clipboard", { value: undefined });
    Object.defineProperty(navigator, "canShare", { value: undefined });
  });
  await page.goto("/?view=daily");
  await expect(page.locator(".weekly-share-buttons")).toBeVisible();
  const current = page.locator(
    ".weekly-daily-leaderboard .leaderboard-current-player",
  );
  await expect(current.locator(".leaderboard-avatar img")).toHaveAttribute(
    "src",
    /rocket.svg$/,
  );
  await expect(current.locator("td").first()).toHaveCSS(
    "background-color",
    "rgb(255, 245, 218)",
  );
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Partager l’image/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^parici-daily.*\.png$/);
  await download.saveAs("/tmp/parici-design-share.png");
});
