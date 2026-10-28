import type { Series } from '../types.js';
import { ema } from './movingAverages.js';

export interface MacdResult {
  /** Fast EMA minus slow EMA. */
  macd: Series;
  /** EMA of the MACD line. */
  signal: Series;
  /** MACD minus signal; its sign flips exactly when the two lines cross. */
  histogram: Series;
}

/** Moving Average Convergence/Divergence, default (12, 26, 9). */
export function macd(closes: readonly number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  if (fast >= slow) throw new RangeError(`MACD fast period (${fast}) must be shorter than slow period (${slow})`);
  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);
  const line: Series = closes.map((_, i) => {
    const f = fastEma[i];
    const s = slowEma[i];
    return f != null && s != null ? f - s : null;
  });
  const signal = ema(line, signalPeriod);
  const histogram: Series = line.map((m, i) => {
    const s = signal[i];
    return m != null && s != null ? m - s : null;
  });
  return { macd: line, signal, histogram };
}
