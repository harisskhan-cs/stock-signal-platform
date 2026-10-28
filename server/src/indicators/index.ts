import type { Bar, Series } from '../types.js';
import { bollinger, type BollingerBands } from './bollinger.js';
import { macd, type MacdResult } from './macd.js';
import { ema, sma } from './movingAverages.js';
import { rsi } from './rsi.js';

export { bollinger, type BollingerBands } from './bollinger.js';
export { macd, type MacdResult } from './macd.js';
export { ema, sma } from './movingAverages.js';
export { rsi } from './rsi.js';
export { findLevels, type PriceLevel, type LevelOptions } from './supportResistance.js';

/** Every indicator the signal rules and strategies need, computed once per request. */
export interface IndicatorSet {
  bars: readonly Bar[];
  closes: number[];
  sma50: Series;
  sma200: Series;
  ema20: Series;
  rsi14: Series;
  macd: MacdResult;
  bollinger: BollingerBands;
}

export function computeIndicators(bars: readonly Bar[]): IndicatorSet {
  const closes = bars.map((b) => b.close);
  return {
    bars,
    closes,
    sma50: sma(closes, 50),
    sma200: sma(closes, 200),
    ema20: ema(closes, 20),
    rsi14: rsi(closes, 14),
    macd: macd(closes),
    bollinger: bollinger(closes),
  };
}
