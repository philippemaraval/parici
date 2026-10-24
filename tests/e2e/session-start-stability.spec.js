const { test, expect } = require("@playwright/test");
const { start } = require("../../backend/domains/game-integrity/sessions");

for (const zone of [
  "stations-metro",
  "monuments",
  "rues-celebres",
  "arrondissements-ville",
  "lignes-transports-idf",
]) {
  test(`${zone}: another click during server preparation cannot stop the game`, async ({
    page,
  }) => {
    await page.route(/^https:\/\//, (route) => route.abort());
    await page.addInitScript(() => {
      localStorage.setItem(
        "camino_paris_user",
        JSON.stringify({ id: 1, username: "JoueurE2E", authenticated: true }),
      );
      localStorage.setItem("camino_auth_token", "e2e-player-token");
    });
    let received = 0;
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    await page.route("**/api/game-sessions", async (route) => {
      received++;
      const receipt = await start(
        { pool: { query: async () => ({ rows: [] }) } },
        1,
        route.request().postDataJSON(),
      );
      await gate;
      await route.fulfill({ json: receipt });
    });
    await page.goto("/?view=camino&e2eMap=1");
    await expect(page.locator("#map-status")).toHaveText("Carte OK", {
      timeout: 20000,
    });
    await page.locator("#mode-select-button").click();
    await page.locator(`#mode-select-list [data-value="${zone}"]`).click();
    await page.locator("#restart-btn").click();
    await expect.poll(() => received).toBe(1);
    // A second click delivered while the API is still preparing the game.
    await page.locator("#restart-btn").dispatchEvent("click");
    release();
    await expect(page.locator("#restart-btn")).toHaveText("Arrêter la session");
    await expect(page.locator("#target-street")).not.toHaveText("—");
    await expect(page.locator("#summary")).toBeHidden();
    expect(received).toBe(1);
    await expect(page.locator("#restart-btn")).toBeEnabled();
  });
}

test("first metro launch waits for server acceptance and stays in the menu on refusal", async ({
  page,
}) => {
  await page.route(/^https:\/\//, (route) => route.abort());
  await page.addInitScript(() => {
    localStorage.setItem(
      "camino_paris_user",
      JSON.stringify({ id: 1, username: "JoueurE2E", authenticated: true }),
    );
    localStorage.setItem("camino_auth_token", "e2e-player-token");
  });
  let requests = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/game-sessions", async (route) => {
    requests++;
    if (requests === 1) {
      await gate;
      return route.fulfill({
        status: 409,
        json: { error: "Référentiel temporairement indisponible. Réessayez." },
      });
    }
    const receipt = await start(
      { pool: { query: async () => ({ rows: [] }) } },
      1,
      route.request().postDataJSON(),
    );
    await route.fulfill({ json: receipt });
  });
  await page.goto("/?view=camino&e2eMap=1");
  await expect(page.locator("#map-status")).toHaveText("Carte OK", {
    timeout: 20000,
  });
  await page.locator("#mode-select-button").click();
  await page.locator('#mode-select-list [data-value="stations-metro"]').click();
  await page.locator("#restart-btn").click();
  await expect.poll(() => requests).toBe(1);
  try {
    await expect(page.locator("body")).not.toHaveClass(/session-running/);
    await expect(page.locator("#restart-btn")).toBeDisabled();
  } finally {
    release();
  }
  await expect(page.locator("#restart-btn")).toBeEnabled();
  await expect(page.locator("#message")).toContainText(
    "Référentiel temporairement indisponible",
  );
  await expect(page.locator("#summary")).toBeHidden();
  await page.locator("#restart-btn").click();
  await expect(page.locator("body")).toHaveClass(/session-running/);
  await expect(page.locator("#target-street")).not.toHaveText("—");
  expect(requests).toBe(2);
});
