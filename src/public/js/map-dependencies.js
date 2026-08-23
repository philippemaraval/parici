(function () {
  "use strict";

  const requestedView = new URLSearchParams(window.location.search).get("view");
  const isCompactViewport = window.matchMedia("(max-width: 900px)").matches;
  const needsMap = !isCompactViewport || requestedView === "camino" || requestedView === "daily";
  const SCRIPT_TIMEOUT_MS = 10000;
  window.CaminoNeedsMapRuntime = needsMap;

  function loadStyle(href, fallbackHref = "") {
    if (document.querySelector(`link[href="${href}"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    if (fallbackHref) {
      link.onerror = () => loadStyle(fallbackHref);
    }
    document.head.appendChild(link);
  }

  function loadScript(src, timeoutMs = SCRIPT_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      let timeoutId;
      const finish = (callback, value) => {
        if (timeoutId) window.clearTimeout(timeoutId);
        callback(value);
      };
      const handleLoad = () => finish(resolve);
      const handleError = () =>
        finish(reject, new Error(`Dépendance cartographique indisponible: ${src}`));

      if (existing) {
        if (existing.dataset.loaded === "true") {
          resolve();
          return;
        }
        existing.addEventListener("load", handleLoad, { once: true });
        existing.addEventListener("error", handleError, { once: true });
      } else {
        const script = document.createElement("script");
        script.src = src;
        script.async = true;
        script.onload = () => {
          script.dataset.loaded = "true";
          handleLoad();
        };
        script.onerror = handleError;
        document.head.appendChild(script);
      }

      timeoutId = window.setTimeout(
        () =>
          reject(
            new Error(`Délai dépassé pour la dépendance cartographique: ${src}`),
          ),
        timeoutMs,
      );
    });
  }

  window.CaminoMapDependencies = needsMap
    ? (async () => {
        loadStyle(
          "/vendor/leaflet.css",
          "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css",
        );
        loadStyle("https://cdn.jsdelivr.net/npm/leaflet-minimap@3.6.1/dist/Control.MiniMap.min.css");
        try {
          await loadScript("/src/public/js/leaflet-runtime.js");
        } catch (error) {
          console.warn("[Map] Runtime Leaflet local indisponible, tentative de secours:", error.message);
          await loadScript("https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js");
        }
        await loadScript("/src/public/js/leaflet.polylineoffset.js");
        loadScript(
          "https://cdn.jsdelivr.net/npm/leaflet-minimap@3.6.1/dist/Control.MiniMap.min.js",
        ).catch((error) => {
          console.warn("[Map] Mini-carte optionnelle indisponible:", error.message);
        });
        return true;
      })()
    : Promise.resolve(false);
})();
