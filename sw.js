/* Blackhole Fitness — service worker
   The document is network-first so a deploy always reaches people; every other
   asset stays cache-first for speed and genuine offline use, with the cached
   page as a last resort when the network is gone. */

/* Bumping this on every commit that touches index.html is still worth doing —
   it purges superseded icons, the manifest and stale CDN copies on activate —
   but it is now defense-in-depth for those secondary assets rather than the
   app's only protection against staleness. The document self-heals on its own:
   navigations go to the network first (see the fetch handler), so a deploy
   where someone forgets to bump this still reaches users on their next load.
   That forgetting is exactly what hid two weeks of shipped work before. */
const CACHE = 'bhf-v9';

const LOCAL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
];
/* external deps — best-effort so a CDN hiccup can't fail the install */
const CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(LOCAL_ASSETS);
    for (const url of CDN_ASSETS) { try { await cache.add(url); } catch (err) {} }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  /* ---- THE DOCUMENT: network-first ----
     Cache-first on the shell meant a visitor kept whatever index.html they
     first cached until CACHE changed bytes — so a deploy without a bump
     reached nobody, permanently. Going to the network first makes that
     unrecoverable state impossible: the newest deploy always wins when the
     network is reachable, and each success refreshes the copy the offline
     branch below falls back to. */
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        /* only overwrite the offline shell with a real page — caching a 404 or
           a 500 here would serve that error back the next time they're offline */
        if (fresh && fresh.ok) {
          const copy = fresh.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy)).catch(() => {});
        }
        return fresh;
      } catch (err) {
        /* offline — the last page that loaded successfully */
        const cached = await caches.match('./index.html');
        return cached || Response.error();
      }
    })());
    return;
  }

  /* ---- EVERYTHING ELSE: cache-first, unchanged ----
     Icons, the manifest and the pinned CDN scripts. None of them can strand
     someone on an old app the way the document can, and they're the assets
     that make a cold offline load work. */
  e.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const res = await fetch(req);
      /* cache same-origin GETs as they're discovered, so a 2nd visit is instant */
      if (res && res.ok && new URL(req.url).origin === self.location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch (err) {
      /* Offline and uncached. Not dead code despite the branch above: a few
         engines don't report request.mode reliably, and a navigation that
         arrives here without it should still get the shell rather than an
         error. Kept deliberately. */
      if (req.mode === 'navigate') {
        const shell = await caches.match('./index.html');
        if (shell) return shell;
      }
      return Response.error();
    }
  })());
});
