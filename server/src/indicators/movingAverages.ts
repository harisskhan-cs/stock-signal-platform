import type { Series } from '../types.js';
import { assertPeriod, emptySeries } from './util.js';

/**
 * Simple moving average: the mean of the last `period` values.
 * Uses a running sum so the whole series is O(n) instead of O(n * period).
 */
export function sma(values: readonly number[], period: number): Series {
  assertPeriod(period, 'SMA');
  const out = emptySeries(values.length);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/**
 * Exponential moving average with smoothing factor k = 2 / (period + 1),
 * seeded with the SMA of the first `period` defined values.
 *
 * Leading nulls are skipped, so this also works on derived series such as
 * the MACD line (whose first values are null while its EMAs warm up).
 */
export function ema(values: readonly (number | null)[], period: number): Series {
  assertPeriod(period, 'EMA');
  const out = emptySeries(values.length);
  const start = values.findIndex((v) => v != null);
  if (start === -1 || values.length - start < period) return out;

  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = start; i < start + period; i++) prev += values[i] as number;
  prev /= period;
  out[start + period - 1] = prev;

  for (let i = start + period; i < values.length; i++) {
    prev = (values[i] as number) * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}
