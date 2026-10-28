import type { IndicatorSet } from '../indicators/index.js';
import { compositeScore } from '../signals/rules.js';

/**
 * A strategy turns indicators into a target position for each bar:
 * 1 = long, 0 = in cash. The position decided at bar i's close is what the
 * engine holds over bar i + 1 (see engine.ts). Strategies are long-only.
 */
export interface StrategyDefinition {
  id: string;
  name: string;
  description: string;
  positions(ind: IndicatorSet): number[];
}

/** Long while `isLong(i)` holds; flat while it is false or its inputs are undefined. */
function stateless(ind: IndicatorSet, isLong: (i: number) => boolean | null): number[] {
  return ind.bars.map((_, i) => (isLong(i) ? 1 : 0));
}

/**
 * Enter when `enter(i)` fires, then stay in until `exit(i)` fires. Used for
 * mean-reversion rules, where the entry and exit conditions differ.
 */
function stateful(ind: IndicatorSet, enter: (i: number) => boolean, exit: (i: number) => boolean): number[] {
  const out: number[] = [];
  let pos = 0;
  for (let i = 0; i < ind.bars.length; i++) {
    if (pos === 0 && enter(i)) pos = 1;
    else if (pos === 1 && exit(i)) pos = 0;
    out.push(pos);
  }
  return out;
}

export const STRATEGIES: readonly StrategyDefinition[] = [
  {
    id: 'composite',
    name: 'Composite signal',
    description: 'Buy when the overall score is bullish (at least two more bullish rules than bearish); sell when it turns bearish.',
    positions: (ind) =>
      stateful(
        ind,
        (i) => (compositeScore(ind, i) ?? 0) >= 0.4,
        (i) => (compositeScore(ind, i) ?? 0) <= -0.2,
      ),
  },
  {
    id: 'trend_filter',
    name: '200-day trend filter',
    description: 'Hold while price is above its 200-day average; move to cash below it.',
    positions: (ind) => stateless(ind, (i) => ind.sma200[i] != null && ind.closes[i] > (ind.sma200[i] as number)),
  },
  {
    id: 'sma_cross',
    name: '50/200 golden cross',
    description: 'Hold while the 50-day average is above the 200-day average.',
    positions: (ind) =>
      stateless(ind, (i) => ind.sma50[i] != null && ind.sma200[i] != null && (ind.sma50[i] as number) > (ind.sma200[i] as number)),
  },
  {
    id: 'macd',
    name: 'MACD crossover',
    description: 'Hold while the MACD line is above its signal line.',
    positions: (ind) =>
      stateless(
        ind,
        (i) => ind.macd.macd[i] != null && ind.macd.signal[i] != null && (ind.macd.macd[i] as number) > (ind.macd.signal[i] as number),
      ),
  },
  {
    id: 'rsi_reversion',
    name: 'RSI mean reversion',
    description: 'Buy when RSI drops below 30 (oversold); sell when it recovers above 50.',
    positions: (ind) =>
      stateful(
        ind,
        (i) => ind.rsi14[i] != null && (ind.rsi14[i] as number) < 30,
        (i) => ind.rsi14[i] != null && (ind.rsi14[i] as number) > 50,
      ),
  },
  {
    id: 'bollinger_reversion',
    name: 'Bollinger mean reversion',
    description: 'Buy on a close below the lower band; sell once price is back above the middle band.',
    positions: (ind) =>
      stateful(
        ind,
        (i) => ind.bollinger.lower[i] != null && ind.closes[i] < (ind.bollinger.lower[i] as number),
        (i) => ind.bollinger.middle[i] != null && ind.closes[i] > (ind.bollinger.middle[i] as number),
      ),
  },
];

export function getStrategy(id: string): StrategyDefinition | undefined {
  return STRATEGIES.find((s) => s.id === id);
}
