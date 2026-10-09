# Simple MMD Viewer

A small but capable **MikuMikuDance (MMD)** viewer that runs entirely in the browser.
Drop in a model folder and a `.vmd` motion, then let the lifelike layer take over:
look-at, breathing, random blinking and permanent/temporary morphs.

Everything happens client-side — no upload, no server, no build step required to *use* it.

## Features

**Loading**
- **Add model** — pick a folder (or the raw files on mobile) and it lists every `.pmx` / `.pmd`
  it found with name, format and size. PMX textures resolve from the same folder: relative
  paths, Windows backslashes, case differences. Missing textures are reported in the status
  bar instead of aborting the load.
- **Drag & drop** a folder or file straight onto the stage.
- **Add motion** — an arbitrary number of `.vmd` files, merged into a single clip with a
  per-motion checkbox, loop, speed and seek bar.
- **Demo** — one click loads the three.js sample model plus a dance motion from CDN.
- **Rest pose** — stops the motion and restores the bind pose.

**Lifelike layer**
- **Look at viewer** — head and both eyes follow the camera, clamped to natural ranges
  (head ±24° / ±13°, eyes ±20° / ±12°) so the neck never breaks. Adjustable strength.
- **Breathing** — chest/spine/shoulder cycle, 6–30 breaths per minute, with neck
  counter-rotation.
- **Random blinking** — randomized interval envelope with an occasional one-eye wink
  (0–100%). Auto-detects `まばたき` / `ウィンク` / `ウィンク右` and English names.
- **Idle sway** — a slow drift so a still pose never looks frozen.
- **Physics** — optional Ammo.js rigid bodies for hair, skirts and accessories.

**Morphs**
- Searchable, filterable morph list with sliders.
- **Temporary** morphs can be overridden by motion data.
- **Permanent** morphs are re-applied every frame on top of the animation, so the motion
  can't reset them.

**Playback**
- Starts **paused** on the first frame. The lifelike layer keeps running while paused.
- Loaded motions stay exactly where they are when you toggle physics or change the motion
  set, and a paused pose is never baked into the motion.

**UI**
- Hide/show the whole interface (button or `H`), or just the side panel (button or `P`).
- Keyboard: `H` interface, `P` panel, `Space` play/pause.
- Responsive layout: desktop side panel, portrait bottom sheet, landscape sheet — with
  safe-area insets, touch-friendly controls and OrbitControls touch gestures.

## Getting started

```bash
npm install      # also fetches the Ammo.js glue + wasm into public/vendor
npm run dev      # dev server on http://localhost:3000
```

Then open the dev server, press **Demo**, and hit **Play**.

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server (`0.0.0.0:3000`) |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the built output |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit tests |

## Using a real model

MMD models are not bundled — they are usually distributed as a folder containing a `.pmx`
(and/or `.pmd`) file plus its textures.

1. Put the model's whole folder somewhere on your machine.
2. Press **Add model** and select that folder.
3. Pick the `.pmx` from the list and press **Load selected model**.
4. Press **Add motion** and select one or more `.vmd` files.

On phones the folder picker isn't available, so the model picker becomes a multi-file picker:
select the `.pmx` together with its textures at once and they are matched by filename.

## Project layout

```
src/
  main.ts          UI wiring: buttons, sliders, file pickers, drag & drop
  viewer.ts        three.js scene, camera, OrbitControls, render loop
  style.css        layout + responsive/mobile styling
  lib/
    assets.ts      folder/file resolution for PMX + textures, VMD merging
    morphs.ts      morph classification (temporary/permanent), filtering
    blink.ts       blink scheduling and envelope
    clip.ts        VMD clip merging
    drop.ts        drag & drop handling
    rng.ts         seeded RNG
  mmd/
    loader.ts      MMDLoader wrappers for PMX/PMD and VMD
    playback.ts    attach/detach/seek — keeps the clip in place across re-attaches
    rig.ts         lifelike bone layer: look-at, breathing, blinking, sway
    ammo.ts        Ammo.js bootstrapping for physics
tests/             Vitest suites for the pure logic above
scripts/
  sync-ammo.mjs    copies Ammo.js glue + wasm into public/vendor
```

## Notes and limitations

- `three` is pinned to **0.171.0** — the last release that ships `MMDLoader` (it was removed
  in 0.172 and moved to the separate `three-mmd-loader` package). The browser console will
  print a deprecation warning for this reason.
- MMD outline rendering (`OutlineEffect`, the anime ink line) is **not** wired up.
- Physics needs a model with rigid bodies defined; a plain PMX will simply do nothing.
- Built as an experimental test project, not a hardened production app.

## Credits

Built on [three.js](https://threejs.org/) (`MMDLoader`, `MMDAnimationHelper`,
`MMDPhysics`), [Ammo.js](https://github.com/kripken/ammo.js/) for Bullet physics, and
[Vite](https://vite.dev/). MMD model and motion formats are the work of the MMD community;
no models or motions are distributed with this project.

## License

MIT
