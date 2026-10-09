import { randRange, type Rng } from './rng';

export interface BlinkState {
  blink: number;
  winkL: number;
  winkR: number;
}

export const NO_BLINK: BlinkState = { blink: 0, winkL: 0, winkR: 0 };

/**
 * Random blinking: waits a randomized interval, then plays a fast
 * close/open envelope. Occasionally the blink becomes a one-eye wink.
 */
export class BlinkScheduler {
  /** average seconds between blinks */
  meanInterval: number;
  /** chance a blink turns into a wink (0..1) */
  winkChance: number;
  closeTime = 0.07;
  openTime = 0.13;

  private timer: number;
  private phase: 'idle' | 'close' | 'open' = 'idle';
  private t = 0;
  private wink = 0;

  constructor(private rng: Rng, meanInterval = 3.5, winkChance = 0.18) {
    this.meanInterval = meanInterval;
    this.winkChance = winkChance;
    this.timer = this.nextInterval();
  }

  private nextInterval(): number {
    return randRange(this.rng, this.meanInterval * 0.35, this.meanInterval * 1.75);
  }

  /**
   * Change the average interval and pull any pending blink into the new range,
   * so the slider feels responsive instead of waiting out the old schedule.
   */
  setMeanInterval(seconds: number): void {
    if (seconds === this.meanInterval) return;
    this.meanInterval = seconds;
    const max = seconds * 1.75;
    if (this.phase === 'idle' && this.timer > max) this.timer = max;
  }

  /** Force a blink right now (nice for the "blink" button in the UI). */
  trigger(forceWink = 0): void {
    if (this.phase !== 'idle') return;
    this.phase = 'close';
    this.t = 0;
    this.wink = forceWink;
  }

  update(dt: number): BlinkState {
    if (this.phase === 'idle') {
      this.timer -= dt;
      if (this.timer <= 0) this.trigger(this.rng() < this.winkChance ? (this.rng() < 0.5 ? 1 : 2) : 0);
      else return { ...NO_BLINK };
    }

    if (this.phase === 'idle') return { ...NO_BLINK };

    this.t += dt;
    let value: number;
    if (this.phase === 'close') {
      value = Math.min(1, this.t / this.closeTime);
      if (this.t >= this.closeTime) {
        this.phase = 'open';
        this.t = 0;
      }
    } else {
      value = Math.max(0, 1 - this.t / this.openTime);
      if (this.t >= this.openTime) {
        this.phase = 'idle';
        this.t = 0;
        this.wink = 0;
        this.timer = this.nextInterval();
      }
    }

    if (this.wink === 1) return { blink: 0, winkL: value, winkR: 0 };
    if (this.wink === 2) return { blink: 0, winkL: 0, winkR: value };
    return { blink: value, winkL: 0, winkR: 0 };
  }
}
