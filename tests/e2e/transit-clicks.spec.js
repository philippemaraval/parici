const { test, expect } = require("@playwright/test");
const path = require("node:path");
const esbuild = require("esbuild");
const root = path.resolve(__dirname, "../..");
const runtime = esbuild.buildSync({
  stdin: {
    contents: "export { loadBusLinesRuntime } from './src/map-runtime.js'",
    resolveDir: root,
  },
  bundle: true,
  write: false,
  format: "iife",
  globalName: "Transit",
  platform: "browser",
}).outputFiles[0].text;
const line = (name, color = "ff0000") => ({
  type: "Feature",
  properties: { name, color },
  geometry: {
    type: "LineString",
    coordinates: [
      [2.34, 48.8566],
      [2.37, 48.8566],
    ],
  },
});
const data = { type: "FeatureCollection", features: [line("Test A")] };
async function harness(page) {
  await page.route("**/transit-harness", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="map" style="height:450px"></div>',
    }),
  );
  await page.route("**/data/paris_transit_lines.geojson*", (route) =>
    route.fulfill({ json: data }),
  );
  await page.goto("/transit-harness");
  await page.addStyleTag({
    path: path.join(root, "node_modules/leaflet/dist/leaflet.css"),
  });
  await page.addScriptTag({
    path: path.join(root, "node_modules/leaflet/dist/leaflet.js"),
  });
  await page.addScriptTag({
    path: path.join(root, "src/public/js/leaflet.polylineoffset.js"),
  });
  await page.addScriptTag({ content: runtime });
  await page.evaluate(() => {
    window.map = L.map("map", {
      zoomAnimation: false,
      fadeAnimation: false,
    }).setView([48.8566, 2.355], 14);
    window.answers = [];
    window.mapClicks = 0;
    map.on("click", () => {
      window.mapClicks++;
      window.answers = [];
    });
  });
}
async function clickLine(page, isMobile, dy = 0) {
  const position = await page.evaluate(() => {
    const p = map.latLngToContainerPoint([48.8566, 2.355]);
    const rect = map.getContainer().getBoundingClientRect();
    return { x: rect.left + p.x, y: rect.top + p.y };
  });
  if (isMobile) await page.touchscreen.tap(position.x, position.y + dy);
  else await page.mouse.click(position.x, position.y + dy);
}
async function load(page, isMobile, options = {}) {
  await page.evaluate(
    async ({ isMobile, options }) => {
      window.bus = await Transit.loadBusLinesRuntime({
        map,
        L,
        isTouchDevice: isMobile,
        uiTheme: { mapBusLine: "#ff0000" },
        handleBusLineClick: (f) => answers.push(f.properties.name),
        ...options,
      });
      bus.busLinesLayer.addTo(map);
    },
    { isMobile, options },
  );
}

test("a real line click survives the map background deselection", async ({
  page,
  isMobile,
}) => {
  await harness(page);
  await load(page, isMobile);
  await clickLine(page, isMobile);
  await expect.poll(() => page.evaluate(() => answers)).toEqual(["Test A"]);
  await clickLine(page, isMobile);
  await expect.poll(() => page.evaluate(() => answers.length)).toBe(2);
  expect(await page.evaluate(() => mapClicks)).toBe(0);
  const box = await page.locator("#map").boundingBox();
  if (isMobile) await page.touchscreen.tap(box.x + box.width / 2, box.y + 40);
  else await page.mouse.click(box.x + box.width / 2, box.y + 40);
  await expect.poll(() => page.evaluate(() => mapClicks)).toBe(1);
});

test("a slightly imprecise click still reaches the visible line", async ({
  page,
  isMobile,
}) => {
  await harness(page);
  await page.evaluate(() => map.off("click"));
  await load(page, isMobile);
  await clickLine(page, isMobile, 6);
  await expect.poll(() => page.evaluate(() => answers)).toEqual(["Test A"]);
});

test("Collect uses the supplied catalogue and shared canvas without fetching another map", async ({
  page,
  isMobile,
}) => {
  await harness(page);
  await page.evaluate(() => {
    window.fetch = () =>
      Promise.reject(new Error("unexpected second map request"));
    window.sharedRenderer = L.canvas({ tolerance: 6 }).addTo(map);
  });
  await page.evaluate(
    async ({ isMobile, data }) => {
      window.bus = await Transit.loadBusLinesRuntime({
        map,
        L,
        runtimeBusLines: data,
        renderer: sharedRenderer,
        isTouchDevice: isMobile,
        uiTheme: { mapBusLine: "#ff0000" },
        handleBusLineClick: (f) => answers.push(f.properties.name),
      });
      bus.busLinesLayer.addTo(map);
    },
    { isMobile, data },
  );
  await expect(page.locator("#map canvas")).toHaveCount(1);
  await clickLine(page, isMobile);
  expect(await page.evaluate(() => answers)).toEqual(["Test A"]);
  await page.evaluate(() => {
    map.removeLayer(bus.busLinesLayer);
    bus.destroy();
    L.polyline(
      [
        [48.8566, 2.34],
        [48.8566, 2.37],
      ],
      { renderer: sharedRenderer, bubblingMouseEvents: false },
    )
      .on("click", () => answers.push("street"))
      .addTo(map);
  });
  await clickLine(page, isMobile);
  expect(await page.evaluate(() => answers)).toEqual(["Test A", "street"]);
});

test("the color picker keeps the original colors after selection feedback", async ({
  page,
  isMobile,
}) => {
  await harness(page);
  await page.route("**/data/paris_transit_lines.geojson*", (route) =>
    route.fulfill({
      json: { ...data, features: [line("Test A"), line("Test B", "0000ff")] },
    }),
  );
  await load(page, isMobile);
  await page.evaluate(() =>
    bus.busLinesLayer.eachLayer((layer) => {
      if (!layer._isBusHitArea) layer.setStyle({ color: "#ffd400" });
    }),
  );
  await clickLine(page, isMobile);
  await page.locator(".leaflet-popup summary").click();
  await expect(
    page.getByRole("button", { name: "Couleur #ff0000", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Couleur #0000ff", exact: true }),
  ).toBeVisible();
});

test("leaving the Parici transport zone removes its empty canvas and allows other zones to receive clicks", async ({
  page,
  isMobile,
}) => {
  await harness(page);
  await page.evaluate(() => {
    window.backgroundRenderer = L.canvas({ tolerance: 6 });
    window.streets = L.polyline(
      [
        [48.8566, 2.34],
        [48.8566, 2.37],
      ],
      { renderer: backgroundRenderer, bubblingMouseEvents: false },
    )
      .on("click", () => answers.push("street"))
      .addTo(map);
    map.removeLayer(streets);
  });
  await load(page, isMobile);
  await expect(page.locator("#map canvas")).toHaveCount(2);
  await page.evaluate(() => {
    map.removeLayer(bus.busLinesLayer);
    streets.addTo(map);
  });
  await expect(page.locator("#map canvas")).toHaveCount(1);
  await clickLine(page, isMobile);
  expect(await page.evaluate(() => answers)).toEqual(["street"]);
  await page.evaluate(() => {
    map.removeLayer(streets);
    bus.busLinesLayer.addTo(map);
  });
  await clickLine(page, isMobile);
  expect(await page.evaluate(() => answers)).toEqual(["street", "Test A"]);
});
