import type { Series } from '../types.js';
import { assertPeriod, emptySeries } from './util.js';

/**
 * Relative Strength Index using Wilder's smoothing.
 *
 * 1. The first average gain/loss is the plain mean of the first `period` changes.
 * 2. After that: avg = (prevAvg * (period - 1) + current) / period.
 * 3. RSI = 100 - 100 / (1 + avgGain / avgLoss).
 *
 * The first value lands on index `period`, because `period` price changes
 * need `period + 1` closes.
 */
export function rsi(closes: readonly number[], period = 14): Series {
  assertPeriod(period, 'RSI');
  const out = emptySeries(closes.length);
  if (closes.length <= period) return out;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gainSum += change;
    else lossSum -= change;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = toRsi(avgGain, avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
    out[i] = toRsi(avgGain, avgLoss);
  }
  return out;
}

function toRsi(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}
