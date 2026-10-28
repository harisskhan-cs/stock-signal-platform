import { describe, expect, it } from 'vitest';
import { bollinger, ema, findLevels, macd, rsi, sma } from '../src/indicators/index.js';
import type { Bar } from '../src/types.js';
import { makeBars, randomWalk } from './helpers.js';

describe('sma', () => {
  it('averages the trailing window and is null during warm-up', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it('returns all nulls when there is less data than the period', () => {
    expect(sma([1, 2], 5)).toEqual([null, null]);
  });

  it('rejects invalid periods', () => {
    expect(() => sma([1, 2, 3], 0)).toThrow(RangeError);
    expect(() => sma([1, 2, 3], 2.5)).toThrow(RangeError);
  });
});

describe('ema', () => {
  it('seeds with the SMA, then applies k = 2 / (period + 1)', () => {
    // period 3 -> k = 0.5; seed = mean(2, 4, 6) = 4
    // next: 8 * 0.5 + 4 * 0.5 = 6; then 10 * 0.5 + 6 * 0.5 = 8
    expect(ema([2, 4, 6, 8, 10], 3)).toEqual([null, null, 4, 6, 8]);
  });

  it('skips leading nulls so it can smooth derived series', () => {
    expect(ema([null, null, 2, 4, 6, 8], 3)).toEqual([null, null, null, null, 4, 6]);
  });

  it('converges to a constant input', () => {
    const out = ema(new Array(50).fill(7), 10);
    expect(out.at(-1)).toBeCloseTo(7, 10);
  });
});

describe('rsi', () => {
  // 15 closes = 14 changes. Gains sum to 3.34 and losses to 1.40, so the first
  // averages are 3.34/14 and 1.40/14: RS = 2.3857, RSI = 100 - 100/3.3857 = 70.46.
  // Next close 46.00 is a 0.28 loss; Wilder smoothing gives RSI 66.25.
  const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0];

  it('matches a hand-computed Wilder RSI', () => {
    const out = rsi(closes, 14);
    expect(out.slice(0, 14).every((v) => v === null)).toBe(true);
    expect(out[14]).toBeCloseTo(70.46, 2);
    expect(out[15]).toBeCloseTo(66.25, 2);
  });

  it('is 100 when price only rises and 0 when it only falls', () => {
    const up = Array.from({ length: 20 }, (_, i) => 100 + i);
    const down = Array.from({ length: 20 }, (_, i) => 100 - i);
    expect(rsi(up).at(-1)).toBe(100);
    expect(rsi(down).at(-1)).toBe(0);
  });

  it('stays within 0..100 on noisy data', () => {
    const values = rsi(randomWalk(500)).filter((v): v is number => v != null);
    expect(values.length).toBe(500 - 14);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThanOrEqual(100);
  });
});

describe('macd', () => {
  const closes = randomWalk(300, 7);
  const result = macd(closes);

  it('is the fast EMA minus the slow EMA', () => {
    const fast = ema(closes, 12);
    const slow = ema(closes, 26);
    expect(result.macd[24]).toBeNull();
    expect(result.macd[25]).toBeCloseTo((fast[25] as number) - (slow[25] as number), 10);
    expect(result.macd[299]).toBeCloseTo((fast[299] as number) - (slow[299] as number), 10);
  });

  it('has a 9-period EMA signal line and histogram = macd - signal', () => {
    // MACD starts at index 25, so its 9-period EMA starts at 25 + 8 = 33.
    expect(result.signal[32]).toBeNull();
    expect(result.signal[33]).not.toBeNull();
    expect(result.histogram[200]).toBeCloseTo((result.macd[200] as number) - (result.signal[200] as number), 10);
  });

  it('rejects a fast period that is not shorter than the slow one', () => {
    expect(() => macd(closes, 26, 12)).toThrow(RangeError);
  });
});

describe('bollinger', () => {
  it('uses the population standard deviation around the SMA', () => {
    // window [2, 4, 4, 4, 5, 5, 7, 9]: mean 5, population sd 2
    const bands = bollinger([2, 4, 4, 4, 5, 5, 7, 9], 8, 2);
    expect(bands.middle[7]).toBe(5);
    expect(bands.upper[7]).toBe(9);
    expect(bands.lower[7]).toBe(1);
    expect(bands.percentB[7]).toBe(1); // close 9 sits exactly on the upper band
    expect(bands.bandwidth[7]).toBeCloseTo(8 / 5, 10);
  });

  it('puts a flat series at the middle with zero width', () => {
    const bands = bollinger(new Array(25).fill(10));
    expect(bands.upper[24]).toBe(10);
    expect(bands.percentB[24]).toBe(0.5);
  });
});

describe('findLevels', () => {
  /** Price oscillates between ~90 and ~110 and finishes at 100. */
  function rangeBound(): Bar[] {
    const closes: number[] = [];
    for (let cycle = 0; cycle < 6; cycle++) {
      for (let i = 0; i <= 10; i++) closes.push(90 + i * 2); // 90 -> 110
      for (let i = 1; i < 10; i++) closes.push(110 - i * 2); // 108 -> 92
    }
    closes.push(94, 96, 98, 100, 100, 100);
    return makeBars(closes).map((b) => ({ ...b, high: b.close, low: b.close }));
  }

  it('finds repeated swing highs as resistance and swing lows as support', () => {
    const levels = findLevels(rangeBound());
    const resistance = levels.find((l) => l.kind === 'resistance');
    const support = levels.find((l) => l.kind === 'support');
    expect(resistance?.price).toBeCloseTo(110, 0);
    expect(resistance?.touches).toBeGreaterThanOrEqual(5);
    expect(support?.price).toBeCloseTo(90, 0);
    expect(support?.distancePct).toBeLessThan(0);
  });

  it('returns levels sorted from highest to lowest price', () => {
    const levels = findLevels(makeBars(randomWalk(400)));
    expect(levels.length).toBeGreaterThan(0);
    for (let i = 1; i < levels.length; i++) expect(levels[i - 1].price).toBeGreaterThanOrEqual(levels[i].price);
  });

  it('returns nothing for empty input', () => {
    expect(findLevels([])).toEqual([]);
  });
});
