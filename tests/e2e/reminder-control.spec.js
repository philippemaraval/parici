const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { buildSync } = require("esbuild");
test.use({ deviceScaleFactor: 1, reducedMotion: "reduce" });
test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\//, (route) => route.abort());
});
const bundle = buildSync({
  entryPoints: [
    path.resolve(__dirname, "../../src/public/js/reminder-control.js"),
  ],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "ReminderControl",
}).outputFiles[0].text;
test("shared reminder controls expose one action and announce the current status", async ({
  page,
}) => {
  await page.setContent(
    '<section id="reminder"><span id="status"></span><i id="icon"></i><button id="enable">Activer</button><button id="disable">Désactiver</button></section>',
  );
  await page.addScriptTag({ content: bundle });
  for (const active of [false, true]) {
    await page.evaluate((active) => {
      const container = document.getElementById("reminder"),
        statusElement = document.getElementById("status");
      ReminderControl.setReminderStatus({
        statusElement,
        container,
        message: active ? "Rappel actif" : "Rappel inactif",
        label: "Rappel Daily",
      });
      ReminderControl.renderReminderControl({
        container,
        statusElement,
        enableButton: document.getElementById("enable"),
        disableButton: document.getElementById("disable"),
        icon: document.getElementById("icon"),
        canEnable: !active,
        canDisable: active,
        label: "le rappel Daily",
      });
    }, active);
    await expect(page.getByRole("button")).toHaveCount(1);
    await expect(page.locator(active ? "#disable" : "#enable")).toBeVisible();
    await expect(page.locator(active ? "#enable" : "#disable")).toHaveAttribute(
      "hidden",
      "",
    );
    await expect(page.locator("#reminder")).toHaveAttribute(
      "title",
      active ? "Rappel actif" : "Rappel inactif",
    );
  }
});
for (const scenario of ["guest", "ios", "denied", "active"]) {
  test(`Daily reminder handles ${scenario} without requesting permission`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript((scenario) => {
      localStorage.clear();
      window.permissionRequests = 0;
      if (scenario !== "guest") {
        localStorage.setItem("camino_auth_token", "reminder-test");
        localStorage.setItem(
          "camino_paris_user",
          JSON.stringify({
            id: 1,
            username: "ReminderTest",
            authenticated: true,
          }),
        );
      }
      Object.defineProperty(window, "Notification", {
        configurable: true,
        value: {
          permission: scenario === "denied" ? "denied" : "granted",
          requestPermission: async () => {
            window.permissionRequests++;
            return "granted";
          },
        },
      });
      Object.defineProperty(window, "PushManager", {
        configurable: true,
        value: function () {},
      });
      const subscription = { endpoint: "https://push.example.test/endpoint" };
      const registration = {
        scope: location.origin + "/",
        update: async () => {},
        pushManager: { getSubscription: async () => subscription },
      };
      Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        value: {
          register: async () => registration,
          getRegistration: async () => registration,
          ready: Promise.resolve(registration),
          addEventListener: () => {},
        },
      });
      if (scenario === "ios") {
        Object.defineProperty(navigator, "userAgent", {
          configurable: true,
          get: () => "iPhone",
        });
        Object.defineProperty(navigator, "standalone", {
          configurable: true,
          value: false,
        });
      }
    }, scenario);
    let release;
    const ready = new Promise((resolve) => {
      release = resolve;
    });
    await page.route("**/api/notifications/public-key", async (route) => {
      if (scenario === "active") await ready;
      await route.fulfill({
        json: { enabled: true, publicKey: "test-public-key" },
      });
    });
    await page.route("**/api/notifications/status*", (route) =>
      route.fulfill({ json: { subscribed: true, currentSubscribed: true } }),
    );
    await page.goto("/?view=daily");
    const card = page.locator(".daily-reminder-card"),
      status = page.locator("#daily-reminder-status");
    if (scenario === "active") {
      await expect(status).toHaveText("Chargement…");
      await expect(card.locator("button:visible")).toHaveCount(0);
      release();
      await expect(page.locator("#daily-reminder-disable-btn")).toBeVisible();
      await expect(page.locator("#daily-reminder-enable-btn")).toBeHidden();
      await expect(card).toHaveAttribute("title", /actif/);
      await expect(page.locator("#daily-reminder-disable-btn")).toHaveAttribute(
        "aria-describedby",
        "daily-reminder-status",
      );
      await testInfo.attach("daily-reminder-active", {
        body: await card.screenshot({
          path: testInfo.outputPath("daily-reminder-active.png"),
        }),
        contentType: "image/png",
      });
    } else if (scenario === "guest") {
      await expect(card).toBeHidden();
      await expect(status).not.toHaveText("Chargement…");
    } else {
      await expect(card).toBeVisible();
      await expect(status).toContainText(
        scenario === "ios" ? "écran d’accueil" : "refusées",
      );
      await expect(card.locator("button:visible")).toHaveCount(0);
      await expect(card).toHaveAttribute(
        "title",
        scenario === "ios" ? /iPhone/ : /refusées/,
      );
    }
    expect(await page.evaluate(() => window.permissionRequests)).toBe(0);
  });
}

test("Collect shares the blocked status and saves privacy without requesting push permission or deleting the Daily subscription", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "camino_paris_user",
      JSON.stringify({ authenticated: true, username: "CollectTest" }),
    );
    window.permissionRequests = 0;
    window.unsubscribed = 0;
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: {
        permission: "denied",
        requestPermission: async () => {
          window.permissionRequests++;
          return "denied";
        },
      },
    });
    Object.defineProperty(window, "PushManager", {
      configurable: true,
      value: function () {},
    });
    const registration = {
      pushManager: {
        getSubscription: async () => ({
          endpoint: "https://push.example.test/daily",
          unsubscribe: async () => {
            window.unsubscribed++;
          },
        }),
      },
    };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        getRegistration: async () => registration,
        addEventListener: () => {},
      },
    });
  });
  let settings = null;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let json = {};
    if (path.endsWith("/session")) json = { id: 1, username: "CollectTest" };
    else if (path.endsWith("/v2/me"))
      json = {
        settings: { visibility: "private", exchanges: "friends", push: false },
      };
    else if (path.endsWith("/v2/settings")) {
      settings = route.request().postDataJSON();
      json = settings;
    } else if (path.endsWith("/notifications")) json = { pushEnabled: false };
    else if (path.endsWith("/push/unsubscribe"))
      json = { keepSubscription: true };
    else if (path.endsWith("/albums")) json = { albums: [], badges: [] };
    else if (path.includes("/collection"))
      json = {
        cards: [],
        total: 0,
        summary: { owned: 0, active: 0, copies: 0 },
      };
    else if (path.endsWith("/weekly-challenge"))
      json = { personal: { progress: [], score: 0 }, leaderboard: [] };
    else if (path.endsWith("/quota")) json = { copies: 0, limit: 4 };
    else if (path.includes("/map/"))
      json = { type: "FeatureCollection", features: [] };
    else if (path.includes("/leaderboard")) json = { players: [] };
    await route.fulfill({ json });
  });
  await page.goto("/collect.html?panel=community");
  await page.locator("#collect-settings").evaluate((el) => {
    el.open = true;
  });
  const form = page.locator("#collect-settings-form");
  await expect(form.locator('[name="visibility"]')).toHaveValue("private");
  await expect(page.locator("#collect-settings-status")).toContainText(
    "refusées",
  );
  await expect(form.locator('[name="quota"]')).toBeDisabled();
  await expect(form.locator('[name="push"]')).toBeDisabled();
  await form.locator('[name="visibility"]').selectOption("friends");
  await form.getByRole("button", { name: "Enregistrer mes réglages" }).click();
  await expect(page.locator("#collect-settings-status")).toContainText(
    "Réglages enregistrés",
  );
  expect(settings).toEqual({
    visibility: "friends",
    exchanges: "friends",
    push: false,
  });
  expect(
    await page.evaluate(() => [window.permissionRequests, window.unsubscribed]),
  ).toEqual([0, 0]);
});
