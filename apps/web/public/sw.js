/*
 * Keeps the app working offline. Built files have unique names, so they can be served from the cache
 * without going stale. The page itself is tried from the network first, so updates still arrive.
 * Image recognition needs the server and is never cached: images must not end up stored here.
 */
const CACHE = "photo-to-chess-v1";
const ENGINE_FILES = ["engine/stockfish-19-lite-single.js", "engine/stockfish-19-lite-single.wasm"];
const SHELL = ["./", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", ...ENGINE_FILES];
// Hosts often send "Vary: Origin", and scripts carry that header while stored copies do not. These
// files are the same whichever page asks, so that difference must not cause a miss.
const MATCH = { ignoreVary: true };

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

// Files the page loaded before this worker took control, which it asks to have stored.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "cache-urls") return;
  const urls = event.data.urls.filter((url) => new URL(url).origin === self.location.origin);
  event.waitUntil(
    caches.open(CACHE).then((cache) => Promise.allSettled(urls.map((url) => cache.add(url)))),
  );
});

async function fromNetworkThenCache(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = (await cache.match(request, MATCH)) ?? (await cache.match("./", MATCH));
    if (cached) return cached;
    throw error;
  }
}

async function fromCacheThenNetwork(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, MATCH);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.includes("/api/")) return;
  event.respondWith(request.mode === "navigate" ? fromNetworkThenCache(request) : fromCacheThenNetwork(request));
});
