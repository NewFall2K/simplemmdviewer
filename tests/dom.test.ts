import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const html = read('index.html');
const main = read('src/main.ts');
const css = read('src/style.css');

describe('index.html', () => {
  it('defines every element id main.ts looks up', () => {
    const ids = [...main.matchAll(/\$<[^>]*>\(\s*'([^']+)'\s*\)|\$\(\s*'([^']+)'\s*\)/g)].map((m) => m[1] ?? m[2]);
    expect(ids.length).toBeGreaterThan(20);
    const missing = [...new Set(ids)].filter((id) => !html.includes(`id="${id}"`));
    expect(missing).toEqual([]);
  });

  it('keeps the scrollable panel inside the dock so the drawer tab is never clipped', () => {
    expect(html).toMatch(/<div id="dock">\s*<button id="panel-tab"[\s\S]*<aside id="panel">/);
  });

  it('uses named buttons instead of emoji-only ones', () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
    expect(emoji.test(html)).toBe(false);
    const ids = ['btn-model', 'btn-motion', 'btn-demo', 'btn-tpose', 'btn-panel', 'btn-ui', 'btn-play', 'btn-show-ui', 'panel-tab', 'btn-load-model'];
    for (const id of ids) {
      const match = html.match(new RegExp(`<button id="${id}"[^>]*>([^<]*)</button>`));
      expect(match?.[1]?.trim().length ?? 0, id).toBeGreaterThan(2);
    }
  });

  it('has a way back from the hidden-UI mode', () => {
    expect(html).toContain('id="btn-show-ui"');
    expect(html).toContain('id="btn-ui"');
  });
});

describe('responsive css', () => {
  it('gives the canvas over to OrbitControls on touch devices', () => {
    expect(css).toMatch(/#stage \{[^}]*touch-action: none/);
  });

  it('turns the panel into a bottom sheet on phones', () => {
    expect(css).toMatch(/@media \(max-width: 860px\)/);
    expect(css).toMatch(/body\.panel-collapsed #dock \{ transform: translateY/);
    expect(css).toMatch(/@media \(max-width: 860px\) and \(orientation: landscape\)/);
  });

  it('enlarges controls for coarse pointers and respects safe areas', () => {
    expect(css).toMatch(/@media \(pointer: coarse\)/);
    expect(css).toContain('env(safe-area-inset-bottom');
    expect(html).toContain('viewport-fit=cover');
  });
});
