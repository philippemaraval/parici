const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");
const root = path.resolve(__dirname, "../..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");
const bundle = esbuild.buildSync({
  stdin: {
    contents: `export { loadBusLinesRuntime } from './src/map-runtime.js';export { reviewMapFeatures } from './src/map-review.js';export { renderDailyGuessHistoryRuntime } from './src/daily-runtime.js';`,
    resolveDir: root,
  },
  bundle: true,
  write: false,
  format: "iife",
  globalName: "Interactions",
  platform: "browser",
}).outputFiles[0].text;

async function harness(page) {
  await page.route("**/interaction-harness", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="history"></div><div id="daily-guesses-history"></div><div id="map" style="height:450px;width:100%"></div></body></html>',
    }),
  );
  await page.goto("/interaction-harness");
  await page.addStyleTag({
    path: path.join(root, "node_modules/leaflet/dist/leaflet.css"),
  });
  await page.addScriptTag({
    path: path.join(root, "node_modules/leaflet/dist/leaflet.js"),
  });
  await page.addScriptTag({
    path: path.join(root, "src/public/js/leaflet.polylineoffset.js"),
  });
  await page.addScriptTag({ content: bundle });
  await page.addScriptTag({
    path: path.join(root, "src/public/js/page-gestures.js"),
  });
  await page.evaluate(() => {
    window.map = L.map("map", { zoomAnimation: false }).setView(
      [48.8566, 2.3522],
      14,
    );
  });
}

test("shared bus corridors require an explicit line on desktop and touch", async ({
  page,
  isMobile,
}) => {
  await harness(page);
  const payload = JSON.parse(source("data/paris_transit_lines.geojson"));
  await page.evaluate(
    async ({ payload, isMobile }) => {
      window.answers = [];
      window.bus = await Interactions.loadBusLinesRuntime({
        map,
        L,
        runtimeBusLines: payload,
        groupSegments: true,
        isTouchDevice: isMobile,
        uiTheme: { mapBusLine: "#049bc5" },
        handleBusLineClick: (feature, layer, names) =>
          answers.push({ name: feature.properties.name, names }),
      });
      bus.busLinesLayer.addTo(map);
      window.shared = bus.busLinesLayer
        .getLayers()
        .find(
          (layer) =>
            !layer._isBusHitArea &&
            layer._validBusLineNames.length > 1 &&
            new Set(
              layer._validBusLineNames.map(
                (name) => bus.busLineLayersByName.get(name)[0].options.color,
              ),
            ).size > 1,
        );
      map.fitBounds(shared.getBounds());
      const clickable = isMobile
        ? bus.busLinesLayer
            .getLayers()
            .find((layer) => layer._visibleBusLine === shared)
        : shared;
      clickable.fire("click", { latlng: shared.getBounds().getCenter() });
    },
    { payload, isMobile },
  );
  const dropdown = page.locator(".leaflet-popup details");
  await expect(dropdown).toBeVisible();
  expect(await page.evaluate(() => answers.length)).toBe(0);
  // No line identifiers are exposed in the popup's visible text or labels.
  expect(await page.locator(".leaflet-popup-content").innerText()).not.toMatch(
    /\d/,
  );
  await dropdown.locator("summary").click();
  await expect
    .poll(async () => {
      const popup = await page.locator(".leaflet-popup").boundingBox();
      const mapBox = await page.locator("#map").boundingBox();
      return popup.y >= mapBox.y;
    })
    .toBe(true);
  const colors = await page.evaluate(() => [
    ...new Set(
      shared._validBusLineNames.map(
        (name) => bus.busLineLayersByName.get(name)[0].options.color,
      ),
    ),
  ]);
  await expect(dropdown.getByRole("button")).toHaveCount(colors.length);
  const color = colors[colors.length - 1];
  const colorNames = await page.evaluate(
    (color) =>
      shared._validBusLineNames.filter(
        (name) => bus.busLineLayersByName.get(name)[0].options.color === color,
      ),
    color,
  );
  const option = dropdown.getByRole("button", {
    name: `Couleur ${color}`,
    exact: true,
  });
  expect(
    await option
      .locator("span")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  ).not.toBe("rgba(0, 0, 0, 0)");
  await page.screenshot({
    path: `/tmp/parici-color-picker-${isMobile ? "mobile" : "desktop"}.png`,
  });
  await option.click();
  expect(await page.evaluate(() => answers)).toEqual([
    { name: colorNames[0], names: colorNames },
  ]);
  await page.evaluate(() => {
    const single = bus.busLinesLayer
      .getLayers()
      .find(
        (layer) =>
          !layer._isBusHitArea && layer._validBusLineNames.length === 1,
      );
    single.fire("click", { latlng: single.getBounds().getCenter() });
  });
  expect(await page.evaluate(() => answers.length)).toBe(2);
});

test("Daily can review a guess without changing its answer style", async ({
  page,
}) => {
  await harness(page);
  const streetPayload = JSON.parse(source("data/paris_rues_light.geojson"));
  const street = streetPayload.features.find((f) => f.properties.name);
  await page.evaluate((street) => {
    window.reviewFeatures = [street];
    window.original = L.geoJSON(street, { style: { color: "#008000" } }).addTo(
      map,
    );
    Interactions.renderDailyGuessHistoryRuntime({
      dailyGuessHistory: [
        { streetName: street.properties.name, distance: 250 },
      ],
      allStreetFeatures: [street],
      onReviewGuess: () =>
        Interactions.reviewMapFeatures(map, L, reviewFeatures),
    });
  }, street);
  await page.locator("#daily-guesses-history button").click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Object.values(map._layers).filter(
            (l) => l.options?.color === "#ff9800",
          ).length,
      ),
    )
    .toBeGreaterThan(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Object.values(map._layers).filter(
            (l) => l.options?.color === "#ff9800",
          ).length,
      ),
    )
    .toBe(0);
  expect(await page.evaluate(() => original.getLayers()[0].options.color)).toBe(
    "#008000",
  );
});

test("page zoom is blocked while map wheel and pinch zoom remain enabled", async ({
  page,
}) => {
  await harness(page);
  expect(
    await page.evaluate(() => {
      const event = new KeyboardEvent("keydown", {
        key: "+",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      document.body.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(true);
  expect(
    await page.evaluate(() => {
      const event = new WheelEvent("wheel", {
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      document.body.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(true);
  expect(
    await page.evaluate(() => {
      const pinch = (target) => {
        const event = new Event("touchmove", {
          bubbles: true,
          cancelable: true,
        });
        Object.defineProperty(event, "touches", { value: [{}, {}] });
        target.dispatchEvent(event);
        return event.defaultPrevented;
      };
      return [pinch(document.body), pinch(document.getElementById("map"))];
    }),
  ).toEqual([true, false]);
  const zoom = await page.evaluate(() => map.getZoom());
  await page.locator("#map").hover();
  await page.mouse.wheel(0, -120);
  await expect
    .poll(() => page.evaluate(() => map.getZoom()))
    .toBeGreaterThan(zoom);
  expect(await page.evaluate(() => map.touchZoom.enabled())).toBe(true);
});

test("mobile map pinch changes map zoom without scaling the page", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "Native touch gesture uses the mobile viewport");
  await harness(page);
  const cdp = await page.context().newCDPSession(page);
  const box = await page.locator("#map").boundingBox();
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  const zoom = await page.evaluate(() => map.getZoom());
  const points = (distance) => [
    { x: x - distance, y, id: 1 },
    { x: x + distance, y, id: 2 },
  ];
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: points(20),
  });
  for (const distance of [30, 45, 65, 85]) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: points(distance),
    });
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(() => page.evaluate(() => map.getZoom()))
    .toBeGreaterThan(zoom);
  expect(await page.evaluate(() => visualViewport.scale)).toBe(1);
});

test("clue photo pinch zooms the image without scaling the page", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "Native touch gesture");
  await harness(page);
  const file = fs
    .readdirSync(path.join(root, "data/daily_images"))
    .find((name) => /\.(jpg|jpeg|png|webp)$/.test(name));
  expect(file).toBeTruthy();
  await page.evaluate((file) => {
    const photo = document.createElement("div");
    photo.className = "daily-image-hint-body";
    photo.style.cssText = "width:300px;margin:10px";
    const image = document.createElement("img");
    image.src = "/data/daily_images/" + file;
    image.style.width = "100%";
    photo.append(image);
    document.body.prepend(photo);
  }, file);
  const image = page.locator(".daily-image-hint-body img");
  await expect(page.locator(".clue-photo-viewport")).toBeVisible();
  await image.evaluate((image) => image.decode());
  const box = await image.boundingBox();
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const points = (d) => [
    { x: x - d, y, id: 1 },
    { x: x + d, y, id: 2 },
  ];
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: points(20),
  });
  for (const d of [30, 45, 65, 85])
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: points(d),
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(() =>
      image.evaluate(
        (image) => new DOMMatrix(getComputedStyle(image).transform).a,
      ),
    )
    .toBeGreaterThan(1);
  expect(await page.evaluate(() => visualViewport.scale)).toBe(1);
});
