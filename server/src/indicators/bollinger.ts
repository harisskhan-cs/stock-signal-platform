import type { Series } from '../types.js';
import { sma } from './movingAverages.js';
import { emptySeries } from './util.js';

export interface BollingerBands {
  upper: Series;
  middle: Series;
  lower: Series;
  /** Where the close sits inside the bands: 0 = lower band, 1 = upper band, <0 or >1 = outside. */
  percentB: Series;
  /** Band width relative to the middle band; low values mean a volatility "squeeze". */
  bandwidth: Series;
}

/**
 * Bollinger Bands: a `period` SMA plus/minus `multiplier` standard deviations.
 * Uses the population standard deviation, as in Bollinger's original definition.
 */
export function bollinger(closes: readonly number[], period = 20, multiplier = 2): BollingerBands {
  const middle = sma(closes, period);
  const n = closes.length;
  const upper = emptySeries(n);
  const lower = emptySeries(n);
  const percentB = emptySeries(n);
  const bandwidth = emptySeries(n);

  for (let i = period - 1; i < n; i++) {
    const mean = middle[i] as number;
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) sq += (closes[j] - mean) ** 2;
    const sd = Math.sqrt(sq / period);
    const up = mean + multiplier * sd;
    const lo = mean - multiplier * sd;
    upper[i] = up;
    lower[i] = lo;
    percentB[i] = up === lo ? 0.5 : (closes[i] - lo) / (up - lo);
    bandwidth[i] = mean === 0 ? null : (up - lo) / mean;
  }
  return { upper, middle, lower, percentB, bandwidth };
}
