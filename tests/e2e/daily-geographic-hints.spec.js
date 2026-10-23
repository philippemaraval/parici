const { test, expect } = require("@playwright/test");
const fs = require("node:fs"),
  path = require("node:path"),
  { buildSync } = require("esbuild");
const {
  createDailyLocationResolver,
} = require("../../backend/domains/game-integrity/daily-location");
const quarters = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "../../data/paris_quartiers.geojson"),
    "utf8",
  ),
);
const { ARRONDISSEMENT_PAR_QUARTIER } = require("../../data_rules");
const resolve = createDailyLocationResolver(quarters);
const bundle = buildSync({
  entryPoints: [path.resolve(__dirname, "../../src/daily-runtime.js")],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "DailyRuntime",
  platform: "browser",
}).outputFiles[0].text;
test("Daily reveals the arrondissement and then a distinct quarter for both legacy formats", async ({
  page,
}, testInfo) => {
  await page.setContent(
    '<meta name="viewport" content="width=device-width, initial-scale=1"><main><div id="daily-guesses-history"></div></main>',
  );
  await page.addStyleTag({ path: path.resolve(__dirname, "../../style.css") });
  await page.addScriptTag({ content: bundle });
  for (const [stored, street] of [
    ["5e arrondissement", { quartier: "Quartier de la Sorbonne" }],
    [
      "Quartier des Arts-et-Métiers",
      { quartier: "Quartier des Arts-et-Métiers" },
    ],
  ]) {
    const location = resolve(stored, street);
    await page.evaluate(
      ({ location, lookup }) => {
        window.renderHints = (count) =>
          DailyRuntime.renderDailyGuessHistoryRuntime({
            dailyGuessHistory: Array.from({ length: count }, () => ({
              streetName: "Rue de Rivoli",
              distance: 500,
              direction: "→",
            })),
            dailyTargetData: { ...location, streetName: "Rue de Bretagne" },
            normalizeArrondissementKey: (s) => s.toLowerCase(),
            arrondissementByArrondissement: new Map(Object.entries(lookup)),
            calculateStreetLengthFromFeatures: () => 0,
            allStreetFeatures: [],
            normalizeName: (s) => s,
          });
        window.renderHints(2);
      },
      { location, lookup: ARRONDISSEMENT_PAR_QUARTIER },
    );
    await expect(page.locator(".daily-hint")).toHaveCount(1);
    await expect(page.locator(".daily-hint")).toContainText("Arrondissement");
    await page.evaluate(() => window.renderHints(4));
    await expect(page.locator(".daily-hint")).toHaveCount(2);
    await expect(page.locator(".daily-hint").nth(1)).toContainText("Quartier");
    await expect(page.locator(".daily-hint").nth(1)).toContainText(
      location.quartier,
    );
  }
  const screenshot = await page.screenshot({
    path: testInfo.outputPath("daily-geographic-hints.png"),
    fullPage: true,
  });
  await testInfo.attach("daily-geographic-hints", {
    body: screenshot,
    contentType: "image/png",
  });
});
