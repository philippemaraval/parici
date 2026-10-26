const { test, expect } = require("@playwright/test");
const a = {
  id: 1,
  name: "Rue Oberkampf",
  family: "street",
  rarity: 2,
  copyId: "13",
  count: 3,
};
const b = {
  id: 2,
  name: "Rue de la République",
  family: "street",
  rarity: 2,
  copyId: "23",
  count: 2,
};
const album = {
  slug: "personal-7",
  name: "Mes promenades",
  targeted: true,
  before: 8,
  after: 9,
  total: 12,
};
async function setup(
  page,
  { incoming = false, empty = false, stale = false } = {},
) {
  await page.addInitScript(() =>
    localStorage.setItem("camino_auth_token", "exchange-local"),
  );
  await page.route(/^https:\/\//, (r) => r.abort());
  const proposals = [],
    acceptances = [],
    queries = [];
  let created = false,
    accepted = false;
  const offer = () => ({
    id: "offer-1",
    maker_id: incoming ? 2 : 1,
    receiver_id: incoming ? 1 : 2,
    maker_name: incoming ? "Bob" : "Alice",
    receiver_name: incoming ? "Alice" : "Bob",
    kind: "direct",
    simple_exchange: true,
    state: accepted ? "accepted" : "active",
    expires_at: "2026-11-01T12:00:00Z",
    offered_ids: [incoming ? "23" : "13"],
    requested_ids: [incoming ? "13" : "23"],
    offered_cards: [{ cardId: incoming ? 2 : 1, quantity: 1 }],
    wanted_cards: [],
    cards: [a, b],
    lastCopies: [],
    copies: [
      { ...a, id: "13", card_id: "1", source: "weekly" },
      { ...b, id: "23", card_id: "2", source: "weekly" },
    ],
  });
  await page.route("**/api/**", async (r) => {
    const req = r.request(),
      url = new URL(req.url()),
      p = url.pathname;
    let json = {};
    if (p === "/api/session") json = { id: 1, username: "Alice" };
    else if (p === "/api/health")
      json = { database: "ready", collectApiVersion: 5 };
    else if (p.endsWith("/v2/config")) json = { enabled: true };
    else if (p.endsWith("/v2/me")) json = { userId: 1 };
    else if (p.endsWith("/v2/duplicates"))
      json = {
        cards: empty ? [] : [{ ...a, spare: 2 }],
        total: empty ? 0 : 1,
        page: 1,
        pageSize: 20,
      };
    else if (p.endsWith("/v2/opportunities")) {
      queries.push(url.searchParams.get("cardId"));
      json = {
        opportunities:
          empty || created
            ? []
            : [
                {
                  partner: { id: 2, username: "Bob" },
                  give: a,
                  receive: b,
                  album,
                },
              ],
        page: 1,
        hasMore: false,
      };
    } else if (p.endsWith("/v2/offers") && req.method() === "POST") {
      proposals.push(req.postDataJSON());
      await new Promise((resolve) => setTimeout(resolve, 150));
      created = true;
      json = offer();
    } else if (p.endsWith("/v2/offers"))
      json = { offers: incoming || created ? [offer()] : [], page: 1 };
    else if (p.endsWith("/v2/offers/offer-1/accept")) {
      acceptances.push(req.postDataJSON());
      if (stale)
        return r.fulfill({
          status: 409,
          json: {
            error:
              "Cet échange n’est plus possible : un exemplaire est devenu unique.",
          },
        });
      accepted = true;
      json = {
        state: "accepted",
        card: { ...b, cardId: 2 },
        progress: {
          kind: "new",
          collection: { before: 4, after: 5, total: 20 },
          albums: [album],
          otherAlbumCount: 0,
        },
      };
    } else if (
      p.endsWith("/v2/history") ||
      p.endsWith("/v2/blocks") ||
      p.endsWith("/v2/friends") ||
      p.endsWith("/v2/activity") ||
      p.endsWith("/v2/personal-albums") ||
      p.includes("/v2/albums/")
    )
      json = [];
    else if (p.endsWith("/collect/personal-albums")) json = { albums: [] };
    else if (p.includes("/collection/page"))
      json = {
        cards: [],
        summary: { owned: 5, active: 20, copies: 7 },
        total: 0,
        page: 1,
        pageSize: 50,
      };
    else if (p.endsWith("/collect/albums")) json = { albums: [], badges: [] };
    else if (p.endsWith("/quota")) json = { copies: 2, limit: 4 };
    else if (p.endsWith("/weekly-challenge"))
      json = {
        personal: { progress: [], score: 0 },
        leaderboard: [],
        startsAt: "2026-10-19",
        endsAt: "2026-10-26",
      };
    else if (p.endsWith("/goal")) json = { goal: null };
    else if (p.includes("/leaderboard")) json = [];
    else if (p.endsWith("/games/pending")) json = { game: null };
    else if (p.endsWith("/collect/games"))
      json = {
        gameId: "00000000-0000-4000-8000-000000000001",
        maxAttempts: 1,
        guesses: [],
        quota: { copies: 2, limit: 4 },
        card: {
          family: "street",
          name: a.name,
          imageReference: "/apple-touch-icon.png",
        },
      };
    else if (p.endsWith("/games/00000000-0000-4000-8000-000000000001/answer"))
      json = {
        correct: true,
        rewardGranted: true,
        ownedCount: 3,
        card: {
          ...a,
          sourceEntityId: a.name,
          rarityLabel: "Peu commune",
          collectionNumber: 1,
        },
        progress: {
          kind: "duplicate",
          collection: { before: 4, after: 4, total: 20 },
          albums: [],
        },
      };
    else if (p === "/api/collect/map/street") {
      await page.waitForFunction(() => Boolean(window.L?.geoJSON));
      await page.evaluate(() => {
        const geo = window.L.geoJSON;
        window.L.geoJSON = (...args) => {
          const layer = geo(...args);
          window.quickExchangeLayer = layer;
          return layer;
        };
      });
      json = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { collect_entity_id: a.name },
            geometry: {
              type: "LineString",
              coordinates: [
                [2.351, 48.8566],
                [2.353, 48.8566],
              ],
            },
          },
        ],
      };
    }
    return r.fulfill({ json });
  });
  return { proposals, acceptances, queries };
}

test("duplicate result opens filtered reciprocal opportunities and sends a reviewed single-card proposal", async ({
  page,
}, info) => {
  const state = await setup(page);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/collect.html?e2eMap=1");
  await page.locator("#collect-next").click();
  await expect(page.locator("#collect-map")).toBeVisible();
  await page.locator("#collect-visual-hint").evaluate((n) => (n.open = false));
  const point = await page.evaluate(() => {
    const layer = window.quickExchangeLayer.getLayers()[0];
    return layer._map.latLngToContainerPoint(layer.getBounds().getCenter());
  });
  const box = await page.locator("#collect-map").boundingBox();
  await page.mouse.click(box.x + point.x, box.y + point.y);
  await page.mouse.click(box.x + point.x, box.y + point.y);
  await page
    .getByRole("button", { name: "Voir mes échanges possibles", exact: true })
    .click();
  await expect(page.locator(".collect-opportunities")).toContainText(
    "Rue de la République",
  );
  await expect(page.locator(".collect-opportunities")).toContainText(
    "Album ciblé",
  );
  expect(state.queries).toContain("1");
  await expect(page.locator(".collect-social-primary button")).toHaveCount(3);
  await expect(page.locator(".collect-social-more")).not.toHaveAttribute(
    "open",
    "",
  );
  await page.locator('[data-social-tab="duplicates"]').click();
  await expect(page.locator("#collect-social-content")).toContainText(
    "3 exemplaires · 2 disponibles",
  );
  await page.locator('[data-duplicate="1"]').click();
  expect(
    await page
      .locator(".collect-opportunities article>h4")
      .first()
      .evaluate((n) => n.clientWidth),
  ).toBeGreaterThan(140);
  await page.screenshot({
    path: info.outputPath("collect-exchange-list.png"),
    fullPage: true,
  });
  await page.locator('[data-opportunity="0"]').click();
  const dialog = page.locator("dialog.collect-social-dialog");
  await expect(dialog).toContainText("Je donne");
  await expect(dialog).toContainText("Je reçois");
  await expect(dialog).toContainText("8 → 9/12");
  await expect(dialog).toContainText("Chacun conserve un exemplaire");
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await dialog.evaluate((n) => n.scrollWidth <= n.clientWidth + 1),
    ).toBe(true);
  }
  await page.setViewportSize(
    info.project.name === "mobile-chromium"
      ? { width: 390, height: 844 }
      : { width: 1440, height: 900 },
  );
  await page.screenshot({
    path: info.outputPath("collect-exchange-proposal.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Proposer l’échange", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".collect-social-status")).toContainText(
    "Proposition envoyée",
  );
  expect(state.proposals).toHaveLength(1);
  expect(state.proposals[0]).toMatchObject({
    simple: true,
    kind: "direct",
    receiverId: "2",
    offeredIds: ["13"],
    requestedIds: ["23"],
  });
  expect(state.acceptances).toHaveLength(0);
  expect(errors).toEqual([]);
});

test("recipient reviews both cards, accepts and sees new-card and album progress", async ({
  page,
}, info) => {
  const state = await setup(page, { incoming: true });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/collect.html?panel=social&tab=offers");
  const offer = page.locator('[data-offer="offer-1"]');
  await expect(offer).toContainText("Je donne");
  await expect(offer).toContainText("Je reçois");
  await expect(offer.locator("[data-offer-refuse]")).toBeVisible();
  await offer.locator("[data-offer-accept]").click();
  const dialog = page.locator("dialog.collect-social-dialog");
  await expect(dialog).toContainText(a.name);
  await expect(dialog).toContainText(b.name);
  await dialog.locator("#social-confirm-trade").click();
  await expect(dialog).toContainText("Échange effectué");
  await expect(dialog).toContainText("Nouvelle carte");
  await expect(dialog).toContainText("4 → 5/20");
  await expect(dialog).toContainText("8 → 9/12");
  await page.screenshot({
    path: info.outputPath("collect-exchange-accepted.png"),
    fullPage: true,
  });
  await expect(page.locator("#collect-error")).toBeEmpty();
  expect(state.acceptances).toEqual([{ confirmed: true }]);
  expect(errors).toEqual([]);
});

test("empty states remain readable and a stale acceptance stays recoverable", async ({
  page,
}) => {
  const state = await setup(page, { incoming: true, empty: true, stale: true });
  await page.goto("/collect.html?panel=social");
  await expect(page.locator("#collect-social-content")).toContainText(
    "Aucun échange réciproque disponible",
  );
  await page.locator('[data-social-tab="duplicates"]').click();
  await expect(page.locator("#collect-social-content")).toContainText(
    "Aucun doublon disponible",
  );
  await page.locator('[data-social-tab="offers"]').click();
  await page.locator("[data-offer-accept]").click();
  await page.locator("#social-confirm-trade").click();
  await expect(page.locator(".collect-modal-status")).toContainText(
    "un exemplaire est devenu unique",
  );
  await expect(page.locator("#social-confirm-trade")).toBeEnabled();
  await page.locator("[data-social-close]").click();
  expect(state.acceptances).toHaveLength(1);
  await page.locator(".collect-social-more>summary").click();
  await page.locator('[data-social-tab="friends"]').click();
  await expect(page.locator("#social-find")).toBeVisible();
});
