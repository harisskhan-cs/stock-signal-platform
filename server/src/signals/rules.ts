import type { IndicatorSet } from '../indicators/index.js';
import { crossedAbove, crossedBelow } from '../indicators/util.js';
import type { Series } from '../types.js';
import { pct, plural, price } from './format.js';

/** +1 bullish, -1 bearish, 0 neutral. */
export type Stance = 1 | 0 | -1;

export interface RuleReading {
  id: string;
  name: string;
  stance: Stance;
  explanation: string;
}

/**
 * A rule that reads the state of the market on bar `i`, using only data up to
 * and including bar `i`. Because of that, the same rules drive both today's
 * summary and the composite strategy in the backtester with no lookahead.
 *
 * `stance` is kept separate from `explain` so the backtester can evaluate
 * thousands of bars without building strings it never shows.
 */
export interface StateRule {
  id: string;
  name: string;
  /** Returns null while the rule's indicators are still warming up. */
  stance(ind: IndicatorSet, i: number): Stance | null;
  explain(ind: IndicatorSet, i: number, stance: Stance): string;
}

const RSI_OVERSOLD = 30;
const RSI_OVERBOUGHT = 70;

export const STATE_RULES: readonly StateRule[] = [
  {
    id: 'trend',
    name: 'Long-term trend',
    stance(ind, i) {
      const avg = ind.sma200[i];
      if (avg == null) return null;
      return ind.closes[i] > avg ? 1 : -1;
    },
    explain(ind, i, stance) {
      const close = ind.closes[i];
      const avg = ind.sma200[i] as number;
      const gap = Math.abs(close - avg) / avg;
      return stance === 1
        ? `Price (${price(close)}) is ${pct(gap)} above its 200-day average (${price(avg)}), so the long-term trend is up.`
        : `Price (${price(close)}) is ${pct(gap)} below its 200-day average (${price(avg)}), so the long-term trend is down.`;
    },
  },
  {
    id: 'ma_regime',
    name: '50/200-day averages',
    stance(ind, i) {
      const fast = ind.sma50[i];
      const slow = ind.sma200[i];
      if (fast == null || slow == null) return null;
      return fast > slow ? 1 : -1;
    },
    explain(ind, i, stance) {
      const since = barsSinceLastCross(ind.sma50, ind.sma200, i);
      const when = since == null ? '' : ` It crossed ${since === 0 ? 'today' : `${plural(since, 'trading day')} ago`}.`;
      return stance === 1
        ? `The 50-day average is above the 200-day average (a "golden cross" setup), which usually marks an uptrend.${when}`
        : `The 50-day average is below the 200-day average (a "death cross" setup), which usually marks a downtrend.${when}`;
    },
  },
  {
    id: 'macd',
    name: 'MACD momentum',
    stance(ind, i) {
      const line = ind.macd.macd[i];
      const signal = ind.macd.signal[i];
      if (line == null || signal == null) return null;
      return line > signal ? 1 : -1;
    },
    explain(ind, i, stance) {
      const line = ind.macd.macd[i] as number;
      const signal = ind.macd.signal[i] as number;
      const hist = ind.macd.histogram;
      const prevHist = hist[i - 1];
      const curHist = hist[i] as number;
      const growing = prevHist != null && Math.abs(curHist) > Math.abs(prevHist);
      const since = barsSinceLastCross(ind.macd.macd, ind.macd.signal, i);
      const recent = since != null && since <= 5 ? ` The lines crossed ${since === 0 ? 'today' : `${plural(since, 'trading day')} ago`}.` : '';
      const pace = growing ? 'and the gap is widening' : 'but the gap is narrowing';
      return stance === 1
        ? `MACD (${line.toFixed(2)}) is above its signal line (${signal.toFixed(2)}) ${pace}, so short-term momentum is up.${recent}`
        : `MACD (${line.toFixed(2)}) is below its signal line (${signal.toFixed(2)}) ${pace}, so short-term momentum is down.${recent}`;
    },
  },
  {
    id: 'rsi',
    name: 'RSI (14)',
    stance(ind, i) {
      const value = ind.rsi14[i];
      if (value == null) return null;
      if (value < RSI_OVERSOLD) return 1;
      if (value > RSI_OVERBOUGHT) return -1;
      return 0;
    },
    explain(ind, i, stance) {
      const value = (ind.rsi14[i] as number).toFixed(0);
      if (stance === 1) return `RSI is ${value}, below ${RSI_OVERSOLD}: the stock is oversold and selling may be overdone, which often comes before a bounce.`;
      if (stance === -1) return `RSI is ${value}, above ${RSI_OVERBOUGHT}: the stock is overbought and buying may be stretched, which often comes before a pullback.`;
      return `RSI is ${value}, between ${RSI_OVERSOLD} and ${RSI_OVERBOUGHT}: neither overbought nor oversold.`;
    },
  },
  {
    id: 'bollinger',
    name: 'Bollinger Bands',
    stance(ind, i) {
      const b = ind.bollinger.percentB[i];
      if (b == null) return null;
      if (b < 0) return 1;
      if (b > 1) return -1;
      return 0;
    },
    explain(ind, i, stance) {
      const { upper, lower, bandwidth } = ind.bollinger;
      const squeeze = isSqueeze(bandwidth, i, 126)
        ? ' The bands are the narrowest they have been in six months (a "squeeze"), which often comes before a big move in either direction.'
        : '';
      if (stance === 1) return `Price closed below the lower band (${price(lower[i] as number)}), an unusually large drop that often snaps back.${squeeze}`;
      if (stance === -1) return `Price closed above the upper band (${price(upper[i] as number)}), an unusually large rise that often cools off.${squeeze}`;
      const b = ind.bollinger.percentB[i] as number;
      const half = b >= 0.5 ? 'upper' : 'lower';
      return `Price is inside the bands, in the ${half} half (${pct(b, 0)} of the way from the lower to the upper band).${squeeze}`;
    },
  },
];

/** Bars since `a` last crossed `b` in either direction, or null if it never did. */
function barsSinceLastCross(a: Series, b: Series, i: number): number | null {
  for (let j = i; j >= 1; j--) {
    if (crossedAbove(a, b, j) || crossedBelow(a, b, j)) return i - j;
  }
  return null;
}

function isSqueeze(bandwidth: Series, i: number, lookback: number): boolean {
  const current = bandwidth[i];
  if (current == null || i < lookback) return false;
  for (let j = i - lookback; j < i; j++) {
    const past = bandwidth[j];
    if (past != null && past < current) return false;
  }
  return true;
}

/**
 * Average stance across all rules on bar `i`, in [-1, 1].
 * Null until every rule has enough data, so early bars aren't scored on a subset.
 */
export function compositeScore(ind: IndicatorSet, i: number): number | null {
  let total = 0;
  for (const rule of STATE_RULES) {
    const s = rule.stance(ind, i);
    if (s == null) return null;
    total += s;
  }
  return total / STATE_RULES.length;
}

export function readRules(ind: IndicatorSet, i: number): RuleReading[] {
  const readings: RuleReading[] = [];
  for (const rule of STATE_RULES) {
    const stance = rule.stance(ind, i);
    if (stance == null) continue;
    readings.push({ id: rule.id, name: rule.name, stance, explanation: rule.explain(ind, i, stance) });
  }
  return readings;
}
