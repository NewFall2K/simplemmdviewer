/**
 * Optional Ammo.js physics for MMD hair / skirt / accessory rigid bodies.
 *
 * three.js' MMDPhysics reads a global `Ammo`, and the Emscripten glue resolves
 * its `.wasm` next to the script, so both files are copied into
 * `public/vendor/` by `scripts/sync-ammo.mjs` and loaded on demand: physics is
 * never downloaded unless the user turns it on.
 */

type AmmoFactory = (config?: { locateFile?: (path: string) => string }) => Promise<unknown>;

let pending: Promise<unknown> | null = null;
const BASE = import.meta.env.BASE_URL || '/';

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(script);
  });
}

export function isAmmoReady(): boolean {
  const factory = (globalThis as { Ammo?: unknown }).Ammo;
  return typeof factory === 'object' && factory !== null;
}

export function loadAmmo(): Promise<unknown> {
  if (!pending) {
    pending = (async () => {
      const glueUrl = `${BASE}vendor/ammo.wasm.js`;
      await injectScript(glueUrl);
      const factory = (globalThis as { Ammo?: AmmoFactory }).Ammo;
      if (typeof factory !== 'function') throw new Error('Ammo.js glue loaded but no factory was exposed');
      const ammo = await factory({ locateFile: (path) => `${BASE}vendor/${path}` });
      // MMDPhysics uses the global `Ammo`.
      (globalThis as { Ammo?: unknown }).Ammo = ammo;
      return ammo;
    })().catch((err) => {
      pending = null;
      throw err;
    });
  }
  return pending;
}
