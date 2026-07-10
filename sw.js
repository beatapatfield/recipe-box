/* ------------------------------------------------------------------
 * Beata's Recipe Box — service worker.
 *
 * Goal: open INSTANTLY every time (even offline at the stove), while
 * still picking up changes after you export and re-upload index.html —
 * with NO need to ever edit this file again.
 *
 * Strategy: STALE-WHILE-REVALIDATE.
 *   1. Serve the saved copy immediately, so the app opens at once and
 *      works with no signal.
 *   2. In the background, quietly fetch the latest copy from GitHub and
 *      save it for next time.
 *   3. If that background copy is genuinely newer than what you're
 *      looking at (different ETag/Last-Modified), tell the page so it
 *      can show a small "New version available — tap to refresh" nudge.
 *
 * Because "newer" is decided from the file's own version headers, you
 * never have to bump a version number in here. Set once, forget.
 * ------------------------------------------------------------------ */

const CACHE = "recipe-box-cache";
// Files to pre-save on install so the very first offline open works.
const CORE = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (event) => {
  self.skipWaiting(); // take over as soon as possible
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(CORE).catch(() => {}))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // only cache reads
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // leave cross-origin alone
  event.respondWith(staleWhileRevalidate(req, req.mode === "navigate"));
});

// A lightweight "which version is this" tag straight from the file's own
// HTTP headers, so we can tell a real republish from an unchanged reload
// without comparing 6MB of content.
function versionTag(res) {
  if (!res || !res.headers) return null;
  return res.headers.get("etag") || res.headers.get("last-modified") || null;
}

function isCacheable(res) {
  return res && res.ok && res.status === 200 && res.type === "basic";
}

async function notifyUpdate() {
  const clients = await self.clients.matchAll({ type: "window" });
  clients.forEach((c) => c.postMessage({ type: "UPDATE_AVAILABLE" }));
}

function staleWhileRevalidate(req, isNavigate) {
  return caches.open(CACHE).then((cache) =>
    cache.match(req, { ignoreSearch: true }).then((cached) => {
      // Kick off a background refresh (don't block the response on it).
      const fetching = fetch(req).then((res) => {
        if (isCacheable(res)) {
          const oldTag = versionTag(cached);
          const newTag = versionTag(res);
          cache.put(req, res.clone());
          // Only nudge the page when the MAIN document actually changed.
          if (isNavigate && cached && oldTag && newTag && oldTag !== newTag) {
            notifyUpdate();
          }
        }
        return res;
      }).catch(() => null);

      // Instant: serve the saved copy if we have one; the refresh above
      // keeps it current for next time. First-ever visit falls back to
      // the network, then to the app shell if we're offline.
      if (cached) return cached;
      return fetching.then((res) => res || fallback(cache, isNavigate));
    })
  );
}

function fallback(cache, isNavigate) {
  if (isNavigate) {
    return cache.match("./index.html")
      .then((a) => a || cache.match("./"))
      .then((r) => r || offlineResponse());
  }
  return offlineResponse();
}

function offlineResponse() {
  return new Response(
    "You're offline and this hasn't been saved yet. Open the app once with internet, then it'll work offline.",
    { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }
  );
}
