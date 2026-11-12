// T015 service worker (scope /). It caches only the static app shell: the HTML, the built assets, the manifest and
// the icons. It never caches /api/* or /auth/* (per-user data and sign-in), which pass straight to the network; the
// review data for offline use lives in IndexedDB (src/client/offline-store.ts), keyed by learner id.
// A new version: bump CACHE. The new worker installs on the next online load, takes over (skipWaiting + claim) and
// deletes the old cache; while offline no update is fetched, so the old worker keeps serving.
const CACHE = "idea-ladder-shell-v1";
const SHELL = "/index.html";
const STATIC = ["/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png"];
/** Navigations whose page is the client shell; a fresh online copy of it refreshes the cached shell. */
const SHELL_PATHS = ["/review", "/ladders", "/settings"];
/** Ladder generation entry: offline it gets the shell, which shows the offline notice (src/client/offline.tsx). */
const START_PATH = "/start";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const res = await fetch(SHELL, { cache: "no-store" });
      if (!res.ok) throw new Error(`shell request failed: ${res.status}`);
      const html = await res.clone().text();
      const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
      await cache.put(SHELL, res);
      await cache.addAll([...STATIC, ...assets]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith("idea-ladder-") && name !== CACHE) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

/** Network first; the cached shell when the network is off or fails. Redirects (signed out) are never cached. */
async function navigate(request, path) {
  if (self.navigator.onLine !== false) {
    try {
      const res = await fetch(request);
      if (SHELL_PATHS.includes(path) && res.ok && res.type === "basic" && !res.redirected) {
        const cache = await caches.open(CACHE);
        await cache.put(SHELL, res.clone());
      }
      return res;
    } catch {
      // offline or the server is unreachable: fall back to the cached shell
    }
  }
  return (await caches.match(SHELL)) ?? Response.error();
}

/** Hashed build assets and the static files never change under one name: cache first. */
async function cacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    const cache = await caches.open(CACHE);
    await cache.put(request, res.clone());
  }
  return res;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;
  if (request.mode === "navigate") {
    if (SHELL_PATHS.includes(url.pathname) || url.pathname === START_PATH) {
      event.respondWith(navigate(request, url.pathname));
    }
    return;
  }
  if (url.pathname.startsWith("/assets/") || STATIC.includes(url.pathname)) event.respondWith(cacheFirst(request));
});

/** Same-origin path only; anything else opens the review. */
const safePath = (value) => (typeof value === "string" && /^\/(?!\/)/.test(value) ? value : "/review");

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" ? data.title : "Idea Ladder";
  const body = typeof data.body === "string" ? data.body : "Cards are due for review.";
  event.waitUntil(
    self.registration.showNotification(title, { body, icon: "/icon-192.png", data: { url: safePath(data.url) } }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(safePath(event.notification.data?.url), self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((w) => w.url === target);
      if (open) return open.focus();
      return self.clients.openWindow(target);
    })(),
  );
});
