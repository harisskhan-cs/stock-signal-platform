import type { Bar, RawBar } from '../src/types.js';

/** Builds bars on consecutive weekdays from a list of closes. High/low sit 1% around the close. */
export function makeBars(closes: readonly number[], start = '2020-01-01'): Bar[] {
  const dates = weekdays(start, closes.length);
  return closes.map((close, i) => ({
    date: dates[i],
    open: i === 0 ? close : closes[i - 1],
    high: close * 1.01,
    low: close * 0.99,
    close,
    volume: 1_000_000,
  }));
}

export function weekdays(start: string, count: number): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  while (out.length < count) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Deterministic PRNG (mulberry32) so "random" test data is identical on every run. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A geometric random walk with a slight upward drift. */
export function randomWalk(count: number, seed = 42, start = 100): number[] {
  const rand = seededRandom(seed);
  const closes = [start];
  for (let i = 1; i < count; i++) closes.push(closes[i - 1] * (1 + (rand() - 0.48) * 0.04));
  return closes;
}

export function toRaw(bars: readonly Bar[]): RawBar[] {
  return bars.map((b) => ({ ...b, adjClose: b.close }));
}
