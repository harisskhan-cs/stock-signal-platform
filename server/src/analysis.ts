import { runBacktest, type BacktestRun } from './backtest/engine.js';
import { eventStudy, type EventStats } from './backtest/eventStudy.js';
import type { StrategyDefinition } from './backtest/strategies.js';
import { computeIndicators, findLevels, type PriceLevel } from './indicators/index.js';
import { detectEvents, type SignalEvent } from './signals/events.js';
import { summarize, type SignalSummary } from './signals/summary.js';
import type { Bar, Series } from './types.js';

/** Bars needed before every indicator (the 200-day average is the slowest) has a value. */
export const WARMUP_BARS = 200;

export class InsufficientDataError extends Error {}

export interface AnalysisResult {
  bars: Bar[];
  indicators: {
    sma50: Series;
    sma200: Series;
    ema20: Series;
    rsi14: Series;
    macd: { macd: Series; signal: Series; histogram: Series };
    bollinger: { upper: Series; middle: Series; lower: Series };
  };
  levels: PriceLevel[];
  summary: SignalSummary;
  events: SignalEvent[];
}

/**
 * Indicators are computed over the full cached history and only then cut to
 * the display range, so a 6-month chart still gets a correct 200-day average
 * on its first bar.
 */
export function analyze(bars: readonly Bar[], from?: string): AnalysisResult {
  if (bars.length === 0) throw new InsufficientDataError('No price history available');
  const ind = computeIndicators(bars);
  const levels = findLevels(bars);
  const events = detectEvents(ind);
  const summary = summarize(ind, levels, events);

  const start = from ? firstIndexOnOrAfter(bars, from) : 0;
  const cut = (s: Series) => s.slice(start).map((v) => (v == null ? null : round(v, 4)));

  return {
    bars: bars.slice(start).map(roundBar),
    indicators: {
      sma50: cut(ind.sma50),
      sma200: cut(ind.sma200),
      ema20: cut(ind.ema20),
      rsi14: cut(ind.rsi14),
      macd: { macd: cut(ind.macd.macd), signal: cut(ind.macd.signal), histogram: cut(ind.macd.histogram) },
      bollinger: { upper: cut(ind.bollinger.upper), middle: cut(ind.bollinger.middle), lower: cut(ind.bollinger.lower) },
    },
    levels: levels.map((l) => ({ ...l, price: round(l.price, 4), distancePct: round(l.distancePct, 6) })),
    summary,
    events: events.filter((e) => e.index >= start),
  };
}

export interface BacktestResult {
  strategy: { id: string; name: string; description: string };
  from: string;
  to: string;
  costBps: number;
  result: BacktestRun;
  benchmark: BacktestRun;
  eventStudy: EventStats[];
}

export interface BacktestOptions {
  from?: string;
  to?: string;
  costBps?: number;
}

/**
 * Runs a strategy and a buy-and-hold benchmark over the same window, with the
 * same costs, so the comparison is apples to apples. The window never starts
 * before the warm-up period, since a strategy that can't see its indicators
 * yet would just sit in cash and look artificially safe.
 */
export function backtest(bars: readonly Bar[], strategy: StrategyDefinition, options: BacktestOptions = {}): BacktestResult {
  const costBps = options.costBps ?? 5;
  if (bars.length < WARMUP_BARS + 20) {
    throw new InsufficientDataError(`Backtesting needs at least ${WARMUP_BARS + 20} trading days of history; this symbol has ${bars.length}.`);
  }

  const ind = computeIndicators(bars);
  const start = Math.max(WARMUP_BARS - 1, options.from ? firstIndexOnOrAfter(bars, options.from) : 0);
  const end = options.to ? lastIndexOnOrBefore(bars, options.to) : bars.length - 1;
  if (end - start < 20) throw new InsufficientDataError('The selected backtest window is too short (needs at least 20 trading days after warm-up).');

  const window = bars.slice(start, end + 1);
  const targets = strategy.positions(ind).slice(start, end + 1);
  const result = runBacktest(window, targets, { costBps });
  const benchmark = runBacktest(window, window.map(() => 1), { costBps });

  // Forward returns may not peek past `end`, so the study only sees bars up to it.
  const visible = bars.slice(0, end + 1);
  const events = detectEvents(ind).filter((e) => e.index <= end);

  return {
    strategy: { id: strategy.id, name: strategy.name, description: strategy.description },
    from: window[0].date,
    to: window[window.length - 1].date,
    costBps,
    result: roundRun(result),
    benchmark: roundRun(benchmark),
    eventStudy: eventStudy(visible, events, start),
  };
}

function firstIndexOnOrAfter(bars: readonly Bar[], date: string): number {
  const i = bars.findIndex((b) => b.date >= date);
  if (i === -1) throw new InsufficientDataError(`No data on or after ${date}`);
  return i;
}

function lastIndexOnOrBefore(bars: readonly Bar[], date: string): number {
  for (let i = bars.length - 1; i >= 0; i--) if (bars[i].date <= date) return i;
  throw new InsufficientDataError(`No data on or before ${date}`);
}

export function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function roundBar(b: Bar): Bar {
  return {
    date: b.date,
    open: round(b.open, 4),
    high: round(b.high, 4),
    low: round(b.low, 4),
    close: round(b.close, 4),
    volume: Math.round(b.volume),
  };
}

function roundRun(run: BacktestRun): BacktestRun {
  return {
    ...run,
    equity: run.equity.map((p) => ({ date: p.date, equity: round(p.equity, 6) })),
    trades: run.trades.map((t) => ({ ...t, entryPrice: round(t.entryPrice, 4), exitPrice: round(t.exitPrice, 4), return: round(t.return, 6) })),
  };
}
