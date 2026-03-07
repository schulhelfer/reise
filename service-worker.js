const VERSION = 3;
const CACHE_NAME = `reiseplaner-v${VERSION}`;
const CACHE_STATIC = CACHE_NAME;
const CACHE_EXTERNAL = `${CACHE_NAME}-external`;

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-32x32.png",
  "./icon-192x192.png",
  "./icon-512x512.png",
  "./service-worker.js",
];

const OPTIONAL_APP_SHELL = [
  "./leaflet/leaflet.css",
  "./leaflet/leaflet.js",
  "./vendor/leaflet/leaflet.css",
  "./vendor/leaflet/leaflet.js",
];

const LEAFLET_PRECACHE_URLS = [
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css",
  "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js",
  "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-icon.png",
  "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-shadow.png",
];

const EXTERNAL_MAP_HOSTS = ["tile.openstreetmap.org", "unpkg.com", "cdn.jsdelivr.net"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_STATIC);
      await cache.addAll(APP_SHELL);
      await Promise.all(OPTIONAL_APP_SHELL.map((path) => cache.add(path).catch(() => null)));

      const externalCache = await caches.open(CACHE_EXTERNAL);
      await Promise.all(LEAFLET_PRECACHE_URLS.map((url) => warmExternalAsset(externalCache, url)));
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("reiseplaner-") && ![CACHE_STATIC, CACHE_EXTERNAL].includes(key))
          .map((key) => caches.delete(key)),
      );

      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(event.request.url);

  if (event.request.mode === "navigate") {
    event.respondWith(handleNavigationRequest(event.request));
    return;
  }

  if (requestUrl.origin === self.location.origin) {
    event.respondWith(cacheFirst(event.request, CACHE_STATIC));
    return;
  }

  if (isTileOrLeafletRequest(requestUrl)) {
    event.respondWith(staleWhileRevalidate(event.request, CACHE_EXTERNAL));
  }
});

async function handleNavigationRequest(request) {
  const cache = await caches.open(CACHE_STATIC);

  try {
    const response = await fetch(request);

    if (response && response.ok) {
      await cache.put(request, response.clone());
      await cache.put("./index.html", response.clone());
    }

    return response;
  } catch {
    return (await cache.match(request)) || (await cache.match("./index.html")) || offlineFallback(request);
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(request);

    if (response && response.ok) {
      await cache.put(request, response.clone());
    }

    return response;
  } catch {
    return offlineFallback(request);
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then(async (response) => {
      if (response && (response.ok || response.type === "opaque")) {
        await cache.put(request, response.clone());
      }

      return response;
    })
    .catch(() => null);

  return cached || networkPromise || offlineFallback(request);
}

function isTileOrLeafletRequest(url) {
  const host = url.hostname.toLowerCase();
  return EXTERNAL_MAP_HOSTS.some((allowedHost) => host === allowedHost || host.endsWith(`.${allowedHost}`));
}

async function warmExternalAsset(cache, url) {
  try {
    const response = await fetch(url);
    if (response && (response.ok || response.type === "opaque")) {
      await cache.put(url, response.clone());
    }
  } catch {
  }
}

function offlineFallback(request) {
  const destination = request?.destination || "";

  if (destination === "document") {
    return new Response(
      "<!doctype html><html lang=\"de\"><meta charset=\"utf-8\"><title>Offline</title><body><h1>Offline</h1><p>Die App wird geladen, sobald eine Verbindung verfügbar ist.</p></body></html>",
      {
        status: 503,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
        },
      },
    );
  }

  return new Response("", { status: 503, statusText: "Offline" });
}
