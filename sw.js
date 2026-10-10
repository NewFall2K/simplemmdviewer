/**
 * Offline shell for the MMD viewer.
 *
 * The viewer is entirely client-side, so "offline" only means: keep the app
 * itself (HTML, JS, CSS, icons, the optional Ammo.js wasm) in the Cache API and
 * serve it without a network. Model and motion files are opened by the user from
 * the filesystem, so they never touch this worker.
 *
 * Two strategies, on purpose:
 *
 *  - **Navigations** are network-first, so a new deployment is picked up as soon
 *    as there is a network, with the cached shell as the offline fallback.
 *  - **Everything else same-origin** is cache-first and remembers what it fetched.
 *    Asset names are content-hashed by Vite, so a cached file is by definition
 *    the right bytes; it also means the shell is complete offline after one visit
 *    without this file needing to know the build's hashes.
 *
 * Cross-origin requests (the CDN demo model) are left alone: offline they fail,
 * which is correct and honest.
 *
 * Bump VERSION when the *strategy* changes; older caches are then dropped. Hashed
 * assets accumulate under one cache across deployments on purpose, so an update
 * that happens while offline cannot empty the cache the running page needs.
 */

const VERSION = 'mmdv-v1';

/** Un-hashed files, so they are worth precaching by name at install time. */
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-64.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      // One missing file must not fail the whole install, so these are added
      // individually instead of with addAll().
      await Promise.all(SHELL.map((url) => cache.add(url).catch(() => undefined)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name.startsWith('mmdv-') && name !== VERSION).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(VERSION);
          if (fresh && fresh.ok) cache.put('./index.html', fresh.clone());
          return fresh;
        } catch (err) {
          const cache = await caches.open(VERSION);
          const offline = (await cache.match('./index.html')) || (await cache.match('./'));
          if (offline) return offline;
          throw err;
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(VERSION);
      const hit = await cache.match(request);
      if (hit) return hit;
      const fresh = await fetch(request);
      if (fresh && fresh.ok && fresh.type === 'basic') cache.put(request, fresh.clone());
      return fresh;
    })(),
  );
});
