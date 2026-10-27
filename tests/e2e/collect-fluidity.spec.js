const { test, expect } = require("@playwright/test");
test.use({ serviceWorkers: "block" });
test("Collect indexes selections and builds a large map cooperatively", async ({
  page,
  isMobile,
}, info) => {
  const [lat, lon] =
    require("../../package.json").name === "marseille-rues-frontend"
      ? [43.2965, 5.3698]
      : [48.8566, 2.3522];
  const features = Array.from({ length: 3000 }, (_, i) => ({
    type: "Feature",
    properties: { name: `Rue ${i}`, collect_entity_id: `street-${i}` },
    geometry: {
      type: "LineString",
      coordinates:
        i < 2
          ? [
              [lon - 0.008, lat + i * 0.003],
              [lon + 0.008, lat + i * 0.003],
            ]
          : [
              [lon + 0.08 + i * 0.00001, lat + 0.08],
              [lon + 0.0801 + i * 0.00001, lat + 0.0801],
            ],
    },
  }));
  await page.route(/^https:\/\//, (route) => route.abort());
  await page.addInitScript(() => {
    localStorage.setItem("camino_auth_token", "test");
    window.framesDuringLoad = 0;
    const tick = () => {
      window.framesDuringLoad++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.route("**/assets/leaflet-runtime*.js", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        `\nwindow.styleUpdates=0;const original=L.Path.prototype.setStyle;L.Path.prototype.setStyle=function(s){window.styleUpdates++;return original.call(this,s);};L.Map.addInitHook(function(){if(this.getContainer().id==='collect-map')window.perfMap=this;});`,
    });
  });
  if (process.env.FLUIDITY_BASELINE_BUNDLE)
    await page.route("**/assets/collect.*.js", (route) =>
      route.fulfill({
        path: process.env.FLUIDITY_BASELINE_BUNDLE,
        contentType: "text/javascript",
      }),
    );
  let answer,
    downloads = 0;
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let json = {};
    if (path === "/api/session") json = { id: 1, username: "Test" };
    else if (path.endsWith("/health"))
      json = { database: "ready", collectApiVersion: 4 };
    else if (path.endsWith("/quota")) json = { copies: 0, limit: 4 };
    else if (path.endsWith("/pending")) json = { game: null };
    else if (path.includes("/map/")) {
      if (path.endsWith("/street")) downloads++;
      json = {
        type: "FeatureCollection",
        features: path.endsWith("/street") ? features : [],
      };
    } else if (path.endsWith("/games") && route.request().method() === "POST")
      json = {
        gameId: "d30c3b37-2c68-460e-81fa-e4a501301612",
        card: {
          name: "Rue 0",
          family: "street",
          sourceEntityId: "street-0",
          imageReference: "/apple-touch-icon.png",
          currentRarity: 1,
        },
        maxAttempts: 3,
        guesses: [],
        quota: { copies: 0, limit: 4 },
      };
    else if (path.endsWith("/answer")) {
      answer = route.request().postDataJSON();
      json = {
        stage: "guess",
        guesses: [{ answerEntityId: answer.answerEntityId, correct: false }],
        remainingAttempts: 2,
      };
    } else if (path.endsWith("/albums")) json = { albums: [], badges: [] };
    else if (path.endsWith("/weekly-challenge"))
      json = { personal: { progress: [], score: 0 }, leaderboard: [] };
    await route.fulfill({ json });
  });
  await page.goto("/collect.html");
  await expect(page.locator("#collect-next")).toBeEnabled();
  await expect.poll(() => downloads).toBe(1);
  await page.waitForTimeout(350);
  const frames = await page.evaluate(() => window.framesDuringLoad),
    started = Date.now();
  await page.locator("#collect-next").click();
  await expect(page.locator("body")).toHaveClass(/collect-session-active/);
  const launchMs = Date.now() - started;
  const metrics = await page.evaluate(() => {
    let paths = 0;
    window.perfMap.eachLayer((layer) => {
      if (layer instanceof L.Polyline) paths++;
    });
    return { paths, frames: window.framesDuringLoad };
  });
  if (!process.env.FLUIDITY_BASELINE_BUNDLE) {
    expect(metrics.paths).toBe(3000);
    expect(metrics.frames).toBeGreaterThan(frames);
  }
  await page.locator("#collect-visual-hint summary").click();
  await page.locator("#collect-map").scrollIntoViewIfNeeded();
  const click = async (index) => {
    const p = await page.evaluate(
      ({ lat, lon, index, touch }) => {
        const map = window.perfMap;
        map.setView([lat, lon], 13, { animate: false });
        const p = map.latLngToContainerPoint([lat + index * 0.003, lon]),
          r = map.getContainer().getBoundingClientRect();
        window.styleUpdates = 0;
        return { x: r.left + p.x, y: r.top + p.y + (touch ? 10 : 0) };
      },
      { lat, lon, index, touch: isMobile },
    );
    if (isMobile) await page.touchscreen.tap(p.x, p.y);
    else await page.mouse.click(p.x, p.y);
    return page.evaluate(() => window.styleUpdates);
  };
  await click(0);
  const selectionStyles = await click(1);
  if (!process.env.FLUIDITY_BASELINE_BUNDLE)
    expect(selectionStyles).toBeLessThan(10);
  expect(answer).toBeUndefined();
  await click(1);
  await expect.poll(() => answer?.answerEntityId).toBe("street-1");
  expect(downloads).toBe(1);
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      project: info.project.name,
      baseline: Boolean(process.env.FLUIDITY_BASELINE_BUNDLE),
      launchMs,
      paths: metrics.paths,
      selectionStyles,
    }),
  );
});
