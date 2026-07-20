// ===========================================
// PLEXEN Calculator — service worker (offline-first PWA, Phase 14)
//
// Strategy: NETWORK-FIRST with a cache fallback, plus a full precache on
// install so the very first offline visit works.
//
// Why not cache-first? This project has already lost real time to stale
// assets (the dev server sends `Cache-Control: no-store` precisely to stop
// the browser serving stale ES modules). A cache-first worker would layer a
// second, longer-lived staleness trap on top of that — you'd ship a fix and
// still be served yesterday's module until a version bump. The whole app is
// ~100 KB of static files, so the network round-trip we pay when online is
// negligible, and we still satisfy "works airplane-mode": every asset is
// precached and served from the cache the moment the network fails.
//
// There are no cross-origin requests to handle — the font is self-hosted
// (D0.8) and the CSP forbids external hosts.
// ===========================================

const VERSION = 'v1';
const CACHE = `plexen-${VERSION}`;

// Every file needed to run offline. `test/ui/pwa.test.js` asserts this list
// matches what is actually on disk, so a new module can't silently break
// offline support.
const PRECACHE = [
    './',
    'index.html',
    'manifest.json',
    'css/calculator.css',
    'assets/fonts/noto-serif-italic-latin.woff2',
    'assets/fonts/noto-sans-mono-lcd.woff2',
    'assets/icons/icon-192.png',
    'assets/icons/icon-512.png',
    'assets/icons/icon-maskable-512.png',
    'js/main.js',
    'js/engine/buffer.js',
    'js/engine/calculator.js',
    'js/engine/emitter.js',
    'js/engine/format.js',
    'js/engine/interpret.js',
    'js/engine/keymap.js',
    'js/engine/memory.js',
    'js/engine/parser.js',
    'js/engine/real.js',
    'js/engine/serialize.js',
    'js/engine/stat.js',
    'js/engine/state.js',
    'js/engine/tokens.js',
    'js/engine/verify.js',
    'js/ui/chrome.js',
    'js/ui/display.js',
    'js/ui/persist.js',
    'js/ui/render-expr.js',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE)
            .then((cache) => cache.addAll(PRECACHE))
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim()),
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    if (new URL(req.url).origin !== self.location.origin) return; // none expected

    event.respondWith(
        fetch(req)
            .then((res) => {
                // Refresh the cache with every successful same-origin response.
                if (res && res.ok && res.type === 'basic') {
                    const copy = res.clone();
                    caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
                }
                return res;
            })
            .catch(() =>
                // Offline: serve the cached copy. ignoreSearch so `calculator.css?v=8`
                // still matches the precached `calculator.css`. A navigation that
                // misses falls back to the app shell.
                caches.match(req, { ignoreSearch: true })
                    .then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : undefined)),
            ),
    );
});
