const { test, expect } = require("@playwright/test");
test.use({ reducedMotion: "reduce" });
const path = require("node:path");
const { buildSync } = require("esbuild");
const bundle = buildSync({
  entryPoints: [path.resolve(__dirname, "../../src/daily-runtime.js")],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "DailyRuntime",
}).outputFiles[0].text;

for (const success of [true, false]) {
  test(`finished Daily immediately shows share actions and ${success ? "reward" : "failure"} in the game`, async ({
    page,
  }, testInfo) => {
    await page.goto("/?view=daily");
    await expect(page.locator("body")).toHaveClass(/app-ready/);
    await page.addScriptTag({ content: bundle });
    await page.evaluate((success) => {
      document.body.classList.add("session-running", "daily-game-over");
      window.dailyRenderOptions = {
        isSessionRunning: true,
        isDailyGameOver: true,
        dailyTargetData: {
          date: "2026-10-24",
          streetName: "Rue de Bretagne",
          collectCardCopy: success
            ? {
                card: {
                  name: "Rue de Bretagne",
                  family: "street",
                  collection_number: 42,
                  current_rarity: 2,
                },
              }
            : null,
        },
        dailyGuessHistory: success
          ? [{ distance: 0 }]
          : Array.from({ length: 7 }, () => ({ distance: 450 })),
        setDailyGuessHistory: () => {},
        getTodayDailyStorageDate: () => "2026-10-24",
        getDailyGuessesStorageKey: (d) => "test-" + d,
        restoreDailyMetaFromStorage: () => {},
        ensureDailyShareContext: async () => true,
        handleDailyShareText: () => {
          window.sharedText = true;
        },
        handleDailyShareImage: () => {
          window.sharedImage = true;
        },
        showMessage: () => {},
      };
      DailyRuntime.updateDailyResultPanelRuntime(window.dailyRenderOptions);
    }, success);
    const panel = page.locator(".target-panel > #daily-result-panel");
    await expect(panel).toBeVisible();
    await expect(panel.locator(".daily-share-btn")).toHaveCount(2);
    await expect(panel.locator(".daily-card-reward")).toHaveCount(
      success ? 1 : 0,
    );
    if (success) {
      const card = panel.locator(".collect-card");
      await expect
        .poll(async () => {
          const box = await card.boundingBox();
          return Math.abs(box.width / box.height - 5 / 7);
        })
        .toBeLessThan(0.01);
      await expect(card.locator(".collect-card-art")).toHaveCSS(
        "position",
        "relative",
      );
    }
    await expect(panel.locator("#daily-share-image")).toHaveCSS(
      "color",
      "rgb(255, 255, 255)",
    );
    await panel.locator("#daily-share-text").click();
    await panel.locator("#daily-share-image").click();
    expect(
      await page.evaluate(() => window.sharedText && window.sharedImage),
    ).toBe(true);
    await testInfo.attach("daily-result", {
      body: await page.screenshot({
        path: testInfo.outputPath("daily-result.png"),
      }),
      contentType: "image/png",
    });
    await page.evaluate(() => {
      document.body.classList.remove("session-running", "daily-game-over");
      DailyRuntime.updateDailyResultPanelRuntime({
        ...window.dailyRenderOptions,
        isSessionRunning: false,
        isDailyGameOver: false,
      });
    });
    await expect(page.locator("#daily-result-panel")).not.toHaveClass(
      /--inline/,
    );
    await page.evaluate(() => {
      document.body.classList.add("session-running");
      DailyRuntime.updateDailyResultPanelRuntime({
        ...window.dailyRenderOptions,
        isDailyGameOver: false,
      });
    });
    await expect(page.locator("#daily-result-panel")).toBeHidden();
    await expect(page.locator("#daily-result-content")).toBeEmpty();
  });
}

test("a completed Daily restores its reward on a fresh browser with no local guesses", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "camino_paris_user",
      JSON.stringify({ id: 1, username: "DailyTest", authenticated: true }),
    );
    localStorage.setItem("camino_auth_token", "e2e-player-token");
  });
  await page.route("**/api/daily", (route) =>
    route.fulfill({
      json: {
        date: "2026-10-24",
        streetName: "Rue de Bretagne",
        arrondissement: "3e arrondissement",
        targetGeoJson: JSON.stringify([2.36, 48.86]),
        userStatus: { success: true, attempts_count: 2 },
        guesses: [{ distance: 350 }, { distance: 0 }],
        collectCardCopy: {
          id: "100",
          card: {
            id: "42",
            name: "Rue de Bretagne",
            family: "street",
            collection_number: 42,
            current_rarity: 2,
          },
        },
      },
    }),
  );
  await page.goto("/?view=daily&e2eMap=1");
  await expect(page.locator("#map-status")).toHaveText("Carte OK", {
    timeout: 15000,
  });
  await page.locator("#daily-mode-btn").click();
  await expect(page.locator("body")).toHaveClass(/daily-game-over/);
  await expect(page.locator(".target-panel #daily-result-panel")).toBeVisible();
  await expect(page.locator(".daily-card-reward")).toContainText(
    "Rue de Bretagne",
  );
  await expect(page.locator(".daily-result--success")).toContainText(
    "2 essais",
  );
  await expect(page.locator(".daily-share-btn")).toHaveCount(2);
});
