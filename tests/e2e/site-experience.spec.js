const { test, expect } = require("@playwright/test");
const path = require("node:path");
const fs = require("node:fs");

test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\//, (route) => route.abort());
});

for (const width of [320, 390, 1440]) {
  test(`every player page remains usable at ${width}px`, async ({
    page,
  }, info) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const routes = [
      ["home", "/"],
      ["camino", "/?view=camino"],
      ["daily", "/?view=daily"],
      ["collect", "/collect.html"],
      ["explorer", "/explorer.html"],
      ["profile", "/?view=profile#profile"],
      ["regles", "/regles.html"],
      ["versions", "/versions.html"],
      ["arbre-rangs", "/arbre-rangs.html"],
      ["remarques", "/remarques.html"],
      ["confidentialite", "/confidentialite.html"],
      ["forgot-password", "/forgot-password.html"],
      ["reset-password", "/reset-password.html"],
    ];
    for (const [name, route] of routes) {
      await page.goto(route);
      await expect(page.locator("html")).toHaveAttribute(
        "data-experience-ready",
        "true",
      );
      await expect(page.locator("html")).toHaveAttribute(
        "data-experience-mode",
        name,
      );
      if (["home", "camino", "daily", "profile"].includes(name)) {
        await expect(page.locator("body")).toHaveClass(/app-ready/);
      }
      if (name === "collect") {
        await expect(page.locator("#collect-auth-gate")).toBeVisible();
        await expect(page.locator("#collect-auth-gate a")).toHaveText(
          "Connectez-vous",
        );
        await expect(page.locator("#collect-auth-gate a")).toHaveAttribute(
          "href",
          "/?view=profile#profile",
        );
        await expect(page.locator("#collect-next")).toBeHidden();
      }
      if (name === "home") {
        await expect(page.locator(".mobile-mode-card")).toHaveCount(3);
        await expect(page.locator(".mobile-home__intro p")).toHaveCSS(
          "text-align",
          "center",
        );
        expect(
          await page
            .locator(".mobile-home__intro")
            .evaluate((el) => getComputedStyle(el, "::after").content),
        ).toBe("none");
        await expect(page.locator(".mobile-mode-card--collect")).toBeVisible();
      }
      if (name === "profile") {
        await expect(page.locator("#auth-username")).toBeVisible();
      }
      if (name === "daily") {
        await expect(page.locator(".mobile-mode-intro--daily")).toBeVisible();
        await expect(page.locator("#mode-select-block")).not.toBeVisible();
      }
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        )
        .toBe(true);
      const active = page.locator(".site-nav > a[aria-current='page']");
      if (["home", "camino", "daily", "collect"].includes(name)) {
        await expect(active).toHaveCount(1);
        await expect(active).toBeVisible();
      }
      if (
        ["home", "camino", "daily", "collect", "explorer", "profile"].includes(
          name,
        )
      ) {
        await page.screenshot({
          path: info.outputPath(
            `parici-design-${info.project.name}-${name}-${width}.png`,
          ),
          animations: "disabled",
        });
      }
    }
    expect(errors).toEqual([]);
  });
}

test("scores keep their final text through repeated updates and reduced motion", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "Explorer starts on a phone");
  await page.goto("/explorer.html");
  const score = page.locator("#explorer-score");
  await expect(score).toBeVisible();
  await expect(score.locator("number-flow")).toHaveCount(1);
  for (const value of [95, 100, 0]) {
    await score.evaluate((node, value) => {
      node.textContent = String(value);
    }, value);
    await expect(score).toHaveText(String(value), { useInnerText: true });
    await expect(score.locator(".is-enhanced")).toHaveCount(1);
    await expect(score.locator("number-flow")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    await expect(score.locator("number-flow")).toBeVisible();
    expect(
      (await score.locator("number-flow").boundingBox()).width,
    ).toBeGreaterThan(0);
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(score.locator("number-flow")).toHaveCSS("display", "none");
  await expect(score.locator(".experience-number__text")).toHaveCSS(
    "opacity",
    "1",
  );
  await expect(score).toHaveText("0", { useInnerText: true });
});

test("navigation works when optional animation chunks cannot load", async ({
  page,
}) => {
  await page.route("**/assets/experience-*.js", (route) => route.abort());
  await page.goto("/");
  await page.locator(".mobile-mode-card--camino").click();
  await expect(page.locator("#restart-btn")).toHaveText("Commencer la session");
  await expect(page.locator("#restart-btn")).toBeEnabled();
  await page.locator(".site-nav a[href='/?view=daily']").click();
  await expect(page.locator(".mobile-mode-intro--daily")).toBeVisible();
  await page.locator(".site-nav a[href='/collect.html']").click();
  await expect(page.locator("#collect-auth-gate")).toBeVisible();
});

test("reduced motion keeps every home link and keyboard navigation available", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const cards = page.locator(".mobile-mode-card");
  await expect(cards).toHaveCount(3);
  const daily = page.locator(".mobile-mode-card--daily");
  await daily.focus();
  await expect(daily).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".mobile-mode-intro--daily")).toBeVisible();
});

for (const mode of ["classique", "chrono", "marathon", "lecture"]) {
  test(`Parici ${mode} still starts with its map and usable controls`, async ({
    page,
    isMobile,
  }, info) => {
    test.setTimeout(90000);
    // The shared test server disables the map for UI-only tests. These cases
    // deliberately serve the real, locally built Leaflet bootstrap instead.
    await page.route("**/assets/map-dependencies.*.js", (route) =>
      route.fulfill({
        path: path.join(
          __dirname,
          "../../dist/assets",
          path.basename(new URL(route.request().url()).pathname),
        ),
        contentType: "text/javascript",
      }),
    );
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "../../dist/data/map/manifest.json"),
      ),
    );
    const overview = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "../../dist", manifest.overview.url),
      ),
    );
    const normalize = (value) =>
      value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
    const famous = new Set(
      [...require("../../data_rules").FAMOUS_STREET_NAMES].map(normalize),
    );
    const visibleFeatures = overview.features.filter((feature) =>
      famous.has(normalize(feature.properties.name || "")),
    );
    // Keep the real geometry for this pool; omit the rest of the city in these
    // lifecycle checks so their duration does not depend on canvas throughput.
    await page.route(
      /\/data\/map\/streets-overview\.[^/]+\.geojson$/,
      (route) =>
        route.fulfill({
          json: { type: "FeatureCollection", features: visibleFeatures },
        }),
    );
    await page.goto("/?view=camino");
    await expect(page.locator("body")).toHaveClass(/app-ready/);
    await page.locator("#game-mode-select-button").click();
    await page.locator(`#game-mode-select-list [data-value="${mode}"]`).click();
    if (mode !== "lecture") await page.locator("#restart-btn").click();
    await expect(page.locator("#map")).toBeVisible();
    await expect(page.locator("body")).toHaveClass(/session-running/, {
      timeout: 15000,
    });
    if (mode === "lecture")
      await expect(page.locator("body")).toHaveClass(/lecture-mode/);
    else await expect(page.locator("#target-street")).not.toHaveText("—");
    await expect(page.locator("#onboarding-banner")).not.toBeVisible();
    await expect(page.locator(".mobile-mode-intro--camino")).not.toBeVisible();
    await page.screenshot({
      path: info.outputPath(
        `parici-design-${info.project.name}-game-${mode}.png`,
      ),
      animations: "disabled",
    });
    if (mode === "lecture") {
      if (isMobile) await page.locator("#lecture-back-btn").click();
      else {
        await page.locator("#game-mode-select-button").click();
        await page
          .locator('#game-mode-select-list [data-value="classique"]')
          .click();
      }
    } else {
      page.once("dialog", (dialog) => dialog.accept());
      await page.locator("#restart-btn").click();
    }
    await expect(page.locator("body")).not.toHaveClass(/session-running/);
    await expect(page.locator("#game-mode-select-button")).toBeVisible();
    await expect(page.locator(".site-nav")).toBeVisible();
  });
}
