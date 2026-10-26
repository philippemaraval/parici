const { test, expect } = require("@playwright/test");

async function setup(page) {
  await page.addInitScript(() =>
    localStorage.setItem("camino_auth_token", "album-target-fixture"),
  );
  await page.route(/^https:\/\//, (r) => r.abort());
  await page.route("**/api/health", (r) =>
    r.fulfill({ json: { database: "ready", collectApiVersion: 4 } }),
  );
  const albums = [
    {
      slug: "streets",
      name: "Toutes les rues",
      active_card_count: 10,
      owned_active_card_count: 2,
      progress: 20,
    },
    {
      slug: "monuments",
      name: "Monuments",
      active_card_count: 5,
      owned_active_card_count: 1,
      progress: 20,
    },
    {
      slug: "districts",
      name: "Quartiers",
      active_card_count: 2,
      owned_active_card_count: 2,
      progress: 100,
    },
  ];
  let goal = null,
    fail = false;
  const writes = [];
  await page.route("**/api/collect/**", (r) => {
    const req = r.request(),
      url = new URL(req.url()),
      path = url.pathname;
    if (path.endsWith("/goal")) {
      if (req.method() === "PUT") {
        const { slug } = req.postDataJSON();
        writes.push(slug);
        if (fail)
          return r.fulfill({
            status: 503,
            json: { error: "Enregistrement indisponible" },
          });
        const a =
          albums.find((a) => a.slug === slug) ||
          (slug === "personal-7"
            ? {
                slug,
                name: "Mes balades",
                active_card_count: 3,
                owned_active_card_count: 1,
              }
            : null);
        goal = a
          ? { ...a, remaining: a.active_card_count - a.owned_active_card_count }
          : null;
      }
      return r.fulfill({ json: { goal } });
    }
    if (path === "/api/collect/albums")
      return r.fulfill({ json: { albums, badges: [] } });
    if (path === "/api/collect/personal-albums")
      return r.fulfill({
        json: { albums: [{ id: 7, name: "Mes balades", total: 3, owned: 1 }] },
      });
    if (path === "/api/collect/personal-albums/7/cards")
      return r.fulfill({
        json: { album: { id: 7, name: "Mes balades" }, cards: [], total: 3 },
      });
    if (path.endsWith("/quota"))
      return r.fulfill({ json: { copies: 0, limit: 4 } });
    if (path.endsWith("/pending")) return r.fulfill({ json: { game: null } });
    if (path.endsWith("/weekly-challenge"))
      return r.fulfill({
        json: {
          personal: { progress: [] },
          leaderboard: [],
          startsAt: "2026-10-19",
          endsAt: "2026-10-26",
        },
      });
    if (path.includes("leaderboard")) return r.fulfill({ json: [] });
    return r.fulfill({ json: {} });
  });
  return {
    writes,
    complete: () => {
      goal = null;
    },
    fail: () => {
      fail = true;
    },
  };
}

test("album targets persist, switch, and can be removed on desktop and mobile", async ({
  page,
}, info) => {
  const state = await setup(page);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/collect.html?panel=albums");
  const streets = page.locator('[data-target-album="streets"]').first();
  await streets.click();
  await expect(streets).toHaveText("Album ciblé");
  await expect(streets).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#collect-target-summary")).toContainText("20 %");
  await expect(page.locator("#collect-target-name")).toContainText("2/10");
  await page.reload();
  await expect(
    page.locator('[data-target-album="streets"]').first(),
  ).toHaveText("Album ciblé");
  await page.locator('[data-target-album="monuments"]').first().click();
  await expect(page.locator("#collect-target-name")).toContainText("Monuments");
  await expect(
    page.locator('[data-target-album="streets"]').first(),
  ).toHaveText("Compléter cet album");
  await expect(
    page.locator('[data-target-album="districts"]').first(),
  ).toBeDisabled();
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  if (info.project.name === "mobile-chromium")
    await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: `/private/tmp/collect-target-${info.project.name}.png`,
    fullPage: true,
  });
  await page.locator("#collect-target-remove").click();
  await expect(page.locator("#collect-target-summary")).toBeHidden();
  expect(state.writes).toEqual(["streets", "monuments", ""]);
  expect(errors).toEqual([]);
});

test("personal albums share the same single target and errors preserve the confirmed choice", async ({
  page,
}) => {
  const state = await setup(page);
  await page.goto("/collect.html?panel=albums");
  await page.locator('[data-personal-album="7"]').click();
  await page.locator('[data-target-album="personal-7"]').click();
  await expect(page.locator("#collect-target-name")).toContainText(
    "Mes balades",
  );
  state.fail();
  await page.locator('[data-target-album="streets"]').first().click();
  await expect(page.locator("#collect-goal-status")).toContainText(
    "Enregistrement indisponible",
  );
  await expect(page.locator("#collect-target-name")).toContainText(
    "Mes balades",
  );
});

test("completion refresh automatically removes the target", async ({
  page,
}) => {
  const state = await setup(page);
  await page.goto("/collect.html?panel=albums");
  await page.locator('[data-target-album="streets"]').first().click();
  await expect(page.locator("#collect-target-summary")).toBeVisible();
  state.complete();
  await page.locator('[data-panel="play"]').click();
  await page.locator('[data-panel="albums"]').click();
  await expect(page.locator("#collect-target-summary")).toBeHidden();
});

test("the button inside an opened album selects the target", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/collect.html?panel=albums");
  await page.locator('[data-album="monuments"]').click();
  const button = page.locator(
    '#collect-album-target-action [data-target-album="monuments"]',
  );
  await expect(button).toBeVisible();
  await button.click();
  await expect(button).toHaveText("Album ciblé");
  await expect(page.locator("#collect-target-name")).toContainText("Monuments");
});
