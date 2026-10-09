import { describe, expect, it } from 'vitest';
import { BlinkScheduler } from '../src/lib/blink';
import { mulberry32 } from '../src/lib/rng';

describe('BlinkScheduler', () => {
  it('stays open until the randomized timer fires', () => {
    const scheduler = new BlinkScheduler(mulberry32(7), 3, 0);
    for (let i = 0; i < 60; i++) expect(scheduler.update(1 / 60).blink).toBe(0);
  });

  it('reaches a fully closed eye and opens again', () => {
    const scheduler = new BlinkScheduler(mulberry32(3), 3, 0);
    let peak = 0;
    let closed = 0;
    const samples: number[] = [];
    for (let i = 0; i < 60 * 8; i++) {
      const state = scheduler.update(1 / 60);
      samples.push(state.blink);
      peak = Math.max(peak, state.blink);
      if (state.blink > 0.99) closed++;
    }
    expect(peak).toBeGreaterThan(0.99);
    expect(closed).toBeGreaterThan(0);
    // Blinks are momentary, not permanent.
    expect(samples[samples.length - 1]).toBe(0);
    expect(samples.filter((v) => v > 0).length).toBeLessThan(60 * 2);
  });

  it('produces one-eye winks when winkChance is 1', () => {
    const scheduler = new BlinkScheduler(mulberry32(11), 2, 1);
    const seen = { winkL: 0, winkR: 0, blink: 0 };
    for (let i = 0; i < 60 * 20; i++) {
      const state = scheduler.update(1 / 60);
      seen.winkL = Math.max(seen.winkL, state.winkL);
      seen.winkR = Math.max(seen.winkR, state.winkR);
      seen.blink = Math.max(seen.blink, state.blink);
    }
    expect(seen.blink).toBe(0);
    expect(seen.winkL + seen.winkR).toBeGreaterThan(0.99);
  });

  it('can be triggered manually', () => {
    const scheduler = new BlinkScheduler(mulberry32(1), 100, 0);
    scheduler.trigger();
    let peak = 0;
    for (let i = 0; i < 40; i++) peak = Math.max(peak, scheduler.update(1 / 60).blink);
    expect(peak).toBeGreaterThan(0.99);
  });
});
