const { expect, test } = require("@playwright/test");

test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\//, (route) => route.abort());
});

test("inscription, déconnexion, connexion et profil", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto("/?view=profile#profile");
  await expect(page.locator("body")).toHaveClass(/app-ready/);
  await page.locator("#user-panel-details").evaluate((element) => {
    element.open = true;
  });

  await page.locator("#auth-username").fill("JoueurE2E");
  await page.locator("#auth-password").fill("mot-de-passe-solide");
  await page.locator("#auth-recovery-email").fill("joueur@example.test");
  await page.locator("#register-btn").click();
  await expect(page.locator("#auth-feedback")).toHaveText("Compte créé !");
  await expect(page.locator("#profile-panel")).toBeVisible();

  await page.locator("#logout-btn").click();
  await page.locator("#auth-username").fill("JoueurE2E");
  await page.locator("#auth-password").fill("mot-de-passe-solide");
  await page.locator("#login-btn").click();
  await expect(page.locator("#auth-feedback")).toHaveText(
    "Connexion réussie !",
  );
});

test("navigation des modes Camino et Daily", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto("/?view=camino");
  await expect(page.locator("body")).toHaveClass(/app-ready/);
  await expect(page.locator("#restart-btn")).toHaveText("Commencer la session");
  await expect(page.locator("#target-street")).toHaveText("—");

  await page.goto("/?view=daily");
  await expect(page.locator(".mobile-mode-intro--daily")).toBeVisible();
  await expect(page.locator("#daily-mode-btn")).toContainText("Daily");
});

test("le Daily affiche le nombre de jours de série à côté de la flamme", async ({
  page,
}) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await page.addInitScript(() => {
    localStorage.setItem(
      "camino_paris_user",
      JSON.stringify({ id: 1, username: "JoueurE2E", authenticated: true }),
    );
    localStorage.setItem("camino_auth_token", "e2e-player-token");
  });
  await page.goto("/?view=daily");

  const streak = page.locator("[data-daily-streak]");
  await expect(streak).toBeVisible();
  await expect(streak.locator("[data-daily-streak-count]")).toHaveText("12");
  await expect(streak.locator("[data-daily-streak-unit]")).toHaveCount(0);
  await expect(streak).toHaveAttribute(
    "aria-label",
    "Série Daily : 12 jours d’affilée",
  );
});

test("le Daily récupère la connexion lorsque iOS signale hors ligne à tort", async ({
  page,
}) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await page.addInitScript(() => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      get: () => false,
    });
    localStorage.setItem(
      "camino_paris_user",
      JSON.stringify({ id: 1, username: "JoueurE2E", authenticated: true }),
    );
    localStorage.setItem("camino_auth_token", "e2e-player-token");
  });

  await page.goto("/?view=daily");

  await expect(page.locator("#offline-banner")).toBeHidden({ timeout: 8000 });
  await expect(page.locator("[data-daily-streak-count]")).toHaveText("12");
  await expect(page.locator("#leaderboard")).not.toContainText(
    "Classements momentanément indisponibles",
  );
});

test("connexion à l’administration et contrôle des permissions", async ({
  page,
}) => {
  await page.goto("/admin/");
  await page.locator("#login-username").fill("editor");
  await page.locator("#login-password").fill("mot-de-passe-solide");
  await page.locator("#login-btn").click();
  await expect(page.locator("#dashboard-section")).toBeVisible();
  await expect(page.locator("#users-admin-card")).toBeVisible();
  await expect(page.locator("#global-status")).toContainText(
    "Connexion réussie",
  );
});
