import type { IndicatorSet } from '../indicators/index.js';
import { crossedAbove, crossedBelow } from '../indicators/util.js';
import type { Direction } from '../types.js';

/**
 * Discrete signals that fire on a single bar (crossovers), as opposed to the
 * state rules which describe a condition that can last for weeks. Events are
 * what the event study measures: "after this fired, what did price do next?"
 */
export interface EventDefinition {
  id: string;
  name: string;
  /** Short label for chart markers. */
  label: string;
  direction: Direction;
  description: string;
  fires(ind: IndicatorSet, i: number): boolean;
}

export interface SignalEvent {
  id: string;
  name: string;
  label: string;
  direction: Direction;
  date: string;
  index: number;
  close: number;
}

export const EVENT_DEFINITIONS: readonly EventDefinition[] = [
  {
    id: 'golden_cross',
    name: 'Golden cross',
    label: 'GC',
    direction: 'bullish',
    description: 'The 50-day average crossed above the 200-day average.',
    fires: (ind, i) => crossedAbove(ind.sma50, ind.sma200, i),
  },
  {
    id: 'death_cross',
    name: 'Death cross',
    label: 'DC',
    direction: 'bearish',
    description: 'The 50-day average crossed below the 200-day average.',
    fires: (ind, i) => crossedBelow(ind.sma50, ind.sma200, i),
  },
  {
    id: 'macd_bull_cross',
    name: 'MACD bullish crossover',
    label: 'MACD↑',
    direction: 'bullish',
    description: 'The MACD line crossed above its signal line.',
    fires: (ind, i) => crossedAbove(ind.macd.macd, ind.macd.signal, i),
  },
  {
    id: 'macd_bear_cross',
    name: 'MACD bearish crossover',
    label: 'MACD↓',
    direction: 'bearish',
    description: 'The MACD line crossed below its signal line.',
    fires: (ind, i) => crossedBelow(ind.macd.macd, ind.macd.signal, i),
  },
  {
    id: 'rsi_oversold_exit',
    name: 'RSI leaves oversold',
    label: 'RSI↑',
    direction: 'bullish',
    description: 'RSI climbed back above 30 after being oversold.',
    fires: (ind, i) => crossedAbove(ind.rsi14, 30, i),
  },
  {
    id: 'rsi_overbought_exit',
    name: 'RSI leaves overbought',
    label: 'RSI↓',
    direction: 'bearish',
    description: 'RSI fell back below 70 after being overbought.',
    fires: (ind, i) => crossedBelow(ind.rsi14, 70, i),
  },
  {
    id: 'bb_lower_break',
    name: 'Close below lower band',
    label: 'BB↓',
    direction: 'bullish',
    description: 'Price closed below the lower Bollinger Band (mean-reversion buy).',
    fires: (ind, i) => crossedBelow(ind.closes, ind.bollinger.lower, i),
  },
  {
    id: 'bb_upper_break',
    name: 'Close above upper band',
    label: 'BB↑',
    direction: 'bearish',
    description: 'Price closed above the upper Bollinger Band (mean-reversion sell).',
    fires: (ind, i) => crossedAbove(ind.closes, ind.bollinger.upper, i),
  },
];

export function detectEvents(ind: IndicatorSet, from = 1): SignalEvent[] {
  const events: SignalEvent[] = [];
  for (let i = Math.max(1, from); i < ind.bars.length; i++) {
    for (const def of EVENT_DEFINITIONS) {
      if (def.fires(ind, i)) {
        events.push({
          id: def.id,
          name: def.name,
          label: def.label,
          direction: def.direction,
          date: ind.bars[i].date,
          index: i,
          close: ind.closes[i],
        });
      }
    }
  }
  return events;
}
