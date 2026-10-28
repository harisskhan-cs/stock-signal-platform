import type { Bar } from '../types.js';

export interface PriceLevel {
  price: number;
  /** Support sits at or below the latest close, resistance above it. */
  kind: 'support' | 'resistance';
  /** How many swing highs/lows landed in this price zone. */
  touches: number;
  lastTouched: string;
  /** (level - close) / close, so negative for support and positive for resistance. */
  distancePct: number;
}

export interface LevelOptions {
  /** How many recent bars to search for swing points. */
  lookback?: number;
  /** A swing high must be the highest high within this many bars on each side. */
  pivotWindow?: number;
  /** Swing points within this fraction of each other are merged into one level. */
  tolerancePct?: number;
  /** Maximum levels returned on each side of the price. */
  maxPerSide?: number;
}

/**
 * Finds support and resistance levels in three steps:
 *
 * 1. Swing points: a bar whose high (low) is the highest (lowest) within
 *    `pivotWindow` bars on both sides. The last `pivotWindow` bars cannot be
 *    swing points yet, because the bars that would confirm them haven't happened.
 * 2. Clustering: swing prices are sorted and merged while they stay within
 *    `tolerancePct` of the running cluster mean. Each cluster is one level and
 *    its size is the number of times price turned there.
 * 3. Selection: on each side of the latest close, keep the nearest levels that
 *    price has turned at least twice (falling back to single touches if none).
 */
export function findLevels(bars: readonly Bar[], options: LevelOptions = {}): PriceLevel[] {
  const { lookback = 250, pivotWindow = 5, tolerancePct = 0.015, maxPerSide = 3 } = options;
  const n = bars.length;
  if (n === 0) return [];

  const start = Math.max(0, n - lookback);
  const pivots: { price: number; index: number }[] = [];
  for (let i = start + pivotWindow; i < n - pivotWindow; i++) {
    if (isSwing(bars, i, pivotWindow, 'high')) pivots.push({ price: bars[i].high, index: i });
    if (isSwing(bars, i, pivotWindow, 'low')) pivots.push({ price: bars[i].low, index: i });
  }

  pivots.sort((a, b) => a.price - b.price);
  const clusters: { sum: number; count: number; lastIndex: number }[] = [];
  for (const p of pivots) {
    const current = clusters.at(-1);
    if (current) {
      const mean = current.sum / current.count;
      if (Math.abs(p.price - mean) / mean <= tolerancePct) {
        current.sum += p.price;
        current.count += 1;
        current.lastIndex = Math.max(current.lastIndex, p.index);
        continue;
      }
    }
    clusters.push({ sum: p.price, count: 1, lastIndex: p.index });
  }

  const close = bars[n - 1].close;
  const levels: PriceLevel[] = clusters.map((c) => {
    const price = c.sum / c.count;
    return {
      price,
      kind: price <= close ? 'support' : 'resistance',
      touches: c.count,
      lastTouched: bars[c.lastIndex].date,
      distancePct: (price - close) / close,
    };
  });

  const pick = (side: PriceLevel['kind']) => {
    const candidates = levels.filter((l) => l.kind === side);
    const tested = candidates.filter((l) => l.touches >= 2);
    return (tested.length > 0 ? tested : candidates)
      .sort((a, b) => Math.abs(a.distancePct) - Math.abs(b.distancePct))
      .slice(0, maxPerSide);
  };

  return [...pick('resistance'), ...pick('support')].sort((a, b) => b.price - a.price);
}

function isSwing(bars: readonly Bar[], i: number, window: number, side: 'high' | 'low'): boolean {
  const value = bars[i][side];
  for (let j = i - window; j <= i + window; j++) {
    if (j === i) continue;
    const other = bars[j][side];
    // Ties on the left still count, so a flat top is reported once (at its last bar).
    const beaten = side === 'high' ? (j < i ? other > value : other >= value) : j < i ? other < value : other <= value;
    if (beaten) return false;
  }
  return true;
}
