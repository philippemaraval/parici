const CACHE_NAME = "parici-v10";

const CORE_PRECACHE_URLS = [
  "/",
  "/index.html",
  "/style.css",
  "/main.js",
  "/data_rules.js",
  "/site.webmanifest",
  "/parici-favicon.ico/favicon.ico",
  "/parici-favicon.ico/favicon-16x16.png",
  "/parici-favicon.ico/favicon-32x32.png",
  "/parici-favicon.ico/android-icon-192x192.png",
  "/parici-favicon.ico/apple-icon-180x180.png",
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
            .filter((key) => key.startsWith("parici-") && key !== CACHE_NAME)
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

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/parici-favicon.ico/android-icon-192x192.png",
      badge: "/parici-favicon.ico/favicon-32x32.png",
      tag: payload.tag || "parici-notification",
      renotify: true,
      data: { url: targetUrl },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = normalizeSameOriginPath(event.notification?.data?.url || "/");

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (!client || !("focus" in client)) continue;
        const sameOrigin = client.url && client.url.startsWith(self.location.origin);
        if (sameOrigin) {
          return client
            .navigate(targetUrl)
            .catch(() => undefined)
            .then(() => client.focus());
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
      return undefined;
    }),
  );
});
