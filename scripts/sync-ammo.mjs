// Copies the Ammo.js glue + wasm from node_modules into public/vendor so the
// browser can load them as plain scripts (MMDPhysics needs a global `Ammo`).
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const from = join(root, 'node_modules', 'three', 'examples', 'jsm', 'libs');
const to = join(root, 'public', 'vendor');
const files = ['ammo.wasm.js', 'ammo.wasm.wasm'];

if (!existsSync(join(from, files[0]))) {
  console.warn('[sync-ammo] three.js ammo.js not found - physics will be unavailable.');
  process.exit(0);
}

mkdirSync(to, { recursive: true });
for (const file of files) copyFileSync(join(from, file), join(to, file));
console.log(`[sync-ammo] copied ${files.join(', ')} -> public/vendor`);
