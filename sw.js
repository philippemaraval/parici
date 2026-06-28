const CACHE_NAME = "camino-paris-v9";

const CORE_PRECACHE_URLS = [
  "/",
  "/index.html",
  "/regles.html",
  "/arbre-rangs.html",
  "/reset-password.html",
  "/style.css?v=20260628-parici",
  "/main.js?v=20260628-parici",
  "/src/public/js/leaflet.polylineoffset.js?v=1",
  "/src/public/css/site-shell.css?v=20260627-pages-map-alignment",
  "/src/public/js/site-shell.js?v=20260609-visit-sessions",
  "/data_rules.js",
  "/site.webmanifest?v=20260628-parici",
  "/apple-touch-icon.png?v=20260628-parici",
  "/camino-paris-favicon.ico/icon-16x16.png",
  "/camino-paris-favicon.ico/icon-32x32.png",
  "/camino-paris-favicon.ico/icon-180x180.png",
  "/camino-paris-favicon.ico/icon-192x192.png",
  "/camino-paris-favicon.ico/icon-512x512.png",
];

const OPTIONAL_CDN_PRECACHE_URLS = [
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://cdn.jsdelivr.net/npm/leaflet-minimap@3.6.1/dist/Control.MiniMap.min.css",
  "https://cdn.jsdelivr.net/npm/leaflet-minimap@3.6.1/dist/Control.MiniMap.min.js",
  "https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js",
];

const CDN_HOSTS = new Set(["unpkg.com", "cdn.jsdelivr.net"]);

async function cacheUrlSafely(cache, url) {
  try {
    await cache.add(url);
  } catch (error) {
    console.warn("[SW] Precache skipped:", url, error?.message || error);
  }
}

function normalizeSameOriginPath(rawUrl) {
  try {
    const parsed = new URL(rawUrl || "/", self.location.origin);
    if (parsed.origin !== self.location.origin) {
      return "/";
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch (error) {
    return "/";
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await Promise.all(CORE_PRECACHE_URLS.map((url) => cacheUrlSafely(cache, url)));
      await Promise.all(OPTIONAL_CDN_PRECACHE_URLS.map((url) => cacheUrlSafely(cache, url)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("camino-paris-") && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request, fallbackKey) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (fallbackKey) {
      const fallback = await caches.match(fallbackKey);
      if (fallback) return fallback;
    }
    throw error;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && response.ok) {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    return cached;
  }

  const response = await networkPromise;
  if (response) return response;
  throw new Error("Network unavailable and no cached response");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) return;

  const isNavigation = request.mode === "navigate";
  const isSameOrigin = url.origin === self.location.origin;
  const isDataRequest = isSameOrigin && url.pathname.startsWith("/data/");
  const isStaticAsset =
    isSameOrigin &&
    (url.pathname.endsWith(".js") ||
      url.pathname.endsWith(".css") ||
      url.pathname.endsWith(".html") ||
      url.pathname.endsWith(".png") ||
      url.pathname.endsWith(".ico") ||
      url.pathname.endsWith(".xml") ||
      url.pathname === "/" ||
      url.pathname.endsWith(".webmanifest"));
  const isCdnAsset = CDN_HOSTS.has(url.hostname);

  if (isNavigation) {
    event.respondWith(networkFirst(request, "/index.html"));
    return;
  }

  if (isDataRequest) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (isStaticAsset) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (isCdnAsset) {
    event.respondWith(cacheFirst(request));
  }
});

self.addEventListener("sync", (event) => {
  if (event.tag !== "camino-explorer-sync") return;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      windowClients.forEach((client) => {
        client.postMessage({ type: "CAMINO_EXPLORER_SYNC" });
      });
    }),
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    payload = {
      body: event.data ? event.data.text() : "",
    };
  }

  const title = payload.title || "Parici";
  const body = payload.body || "Le Daily du jour est disponible.";
  const targetUrl = normalizeSameOriginPath(payload.url || "/");
  const notificationTag = payload.tag || "camino-notification";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/camino-paris-favicon.ico/icon-192x192.png",
      badge: "/camino-paris-favicon.ico/icon-32x32.png",
      tag: notificationTag,
      renotify: true,
      timestamp: Date.now(),
      data: {
        url: targetUrl,
        tag: notificationTag,
      },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = normalizeSameOriginPath(event.notification?.data?.url || "/");
  const absoluteTargetUrl = new URL(targetUrl, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (!client || !("focus" in client)) continue;
        const sameOrigin = client.url && client.url.startsWith(self.location.origin);
        if (sameOrigin) {
          return client
            .navigate(absoluteTargetUrl)
            .catch(() => undefined)
            .then(() => client.focus());
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(absoluteTargetUrl);
      }
      return undefined;
    }),
  );
});
