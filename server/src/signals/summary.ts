import type { IndicatorSet, PriceLevel } from '../indicators/index.js';
import type { SignalEvent } from './events.js';
import { pct, plural, price } from './format.js';
import { compositeScore, readRules, type RuleReading, type Stance } from './rules.js';

export type Verdict = 'Strongly bullish' | 'Bullish' | 'Neutral' | 'Bearish' | 'Strongly bearish';

/** Support/resistance observations. Shown to the user but not part of the score (see below). */
export interface ContextNote {
  id: string;
  stance: Stance;
  explanation: string;
}

export interface SignalSummary {
  asOf: string;
  close: number;
  /** Average rule stance in [-1, 1]; null if there isn't enough history (~200 bars). */
  score: number | null;
  verdict: Verdict | null;
  headline: string;
  readings: RuleReading[];
  context: ContextNote[];
  recentEvents: SignalEvent[];
}

const NEAR_LEVEL = 0.02;
const RECENT_BARS = 10;

export function toVerdict(score: number): Verdict {
  if (score >= 0.6) return 'Strongly bullish';
  if (score >= 0.2) return 'Bullish';
  if (score > -0.2) return 'Neutral';
  if (score > -0.6) return 'Bearish';
  return 'Strongly bearish';
}

/**
 * Builds today's plain-English read of the chart.
 *
 * The score only uses the state rules, because those are exactly what the
 * composite strategy trades on in the backtester, so the verdict shown here
 * has a measured track record. Support/resistance is reported as context
 * instead: levels depend on swing points that are only confirmed several bars
 * later, so scoring them historically would leak future data into the test.
 */
export function summarize(ind: IndicatorSet, levels: readonly PriceLevel[], events: readonly SignalEvent[]): SignalSummary {
  const last = ind.bars.length - 1;
  const bar = ind.bars[last];
  const readings = readRules(ind, last);
  const score = compositeScore(ind, last);
  const verdict = score == null ? null : toVerdict(score);

  const bullish = readings.filter((r) => r.stance === 1).length;
  const bearish = readings.filter((r) => r.stance === -1).length;
  const neutral = readings.length - bullish - bearish;
  const headline =
    verdict == null
      ? `Only ${plural(ind.bars.length, 'day')} of history, so not every indicator can be computed yet (the 200-day average needs 200).`
      : `${bullish} of ${readings.length} indicators are bullish, ${bearish} bearish and ${neutral} neutral, so the overall read is ${verdict.toLowerCase()}.`;

  return {
    asOf: bar.date,
    close: bar.close,
    score,
    verdict,
    headline,
    readings,
    context: levelContext(ind, levels),
    recentEvents: events.filter((e) => e.index > last - RECENT_BARS),
  };
}

function levelContext(ind: IndicatorSet, levels: readonly PriceLevel[]): ContextNote[] {
  const notes: ContextNote[] = [];
  const last = ind.bars.length - 1;
  const close = ind.closes[last];
  const support = levels.filter((l) => l.kind === 'support').sort((a, b) => b.price - a.price)[0];
  const resistance = levels.filter((l) => l.kind === 'resistance').sort((a, b) => a.price - b.price)[0];

  if (support) {
    const brokeOut = crossedLevelRecently(ind.closes, support.price, last, 'up');
    if (brokeOut) {
      notes.push({
        id: 'breakout',
        stance: 1,
        explanation: `Price broke above ${price(support.price)} in the last few days. That level was resistance (${plural(support.touches, 'turn')}) and may now act as support.`,
      });
    } else {
      const near = Math.abs(support.distancePct) <= NEAR_LEVEL;
      notes.push({
        id: 'support',
        stance: near ? 1 : 0,
        explanation: near
          ? `Price is testing support at ${price(support.price)} (${pct(Math.abs(support.distancePct))} below), a level where it turned ${plural(support.touches, 'time')}.`
          : `Nearest support is ${price(support.price)}, ${pct(Math.abs(support.distancePct))} below the close (${plural(support.touches, 'turn')} there).`,
      });
    }
  }

  if (resistance) {
    const brokeDown = crossedLevelRecently(ind.closes, resistance.price, last, 'down');
    if (brokeDown) {
      notes.push({
        id: 'breakdown',
        stance: -1,
        explanation: `Price fell below ${price(resistance.price)} in the last few days. That level was support (${plural(resistance.touches, 'turn')}) and may now act as resistance.`,
      });
    } else {
      const near = resistance.distancePct <= NEAR_LEVEL;
      notes.push({
        id: 'resistance',
        stance: near ? -1 : 0,
        explanation: near
          ? `Price is pressing against resistance at ${price(resistance.price)} (${pct(resistance.distancePct)} above), a level where it turned ${plural(resistance.touches, 'time')}.`
          : `Nearest resistance is ${price(resistance.price)}, ${pct(resistance.distancePct)} above the close (${plural(resistance.touches, 'turn')} there).`,
      });
    }
  }

  if (support && !resistance) {
    notes.push({
      id: 'no_resistance',
      stance: 0,
      explanation: 'Price is above every swing high of the past year, so there is no nearby resistance overhead.',
    });
  }

  if (notes.length === 0 && Number.isFinite(close)) {
    notes.push({ id: 'levels', stance: 0, explanation: 'Not enough swing highs and lows yet to identify support or resistance.' });
  }
  return notes;
}

function crossedLevelRecently(closes: readonly number[], level: number, last: number, dir: 'up' | 'down', within = 5): boolean {
  const lastClose = closes[last];
  if (dir === 'up' ? lastClose <= level : lastClose >= level) return false;
  for (let i = last - 1; i >= Math.max(0, last - within); i--) {
    if (dir === 'up' ? closes[i] <= level : closes[i] >= level) return true;
  }
  return false;
}
