import { describe, expect, it } from 'vitest';
import { backtest, InsufficientDataError } from '../src/analysis.js';
import { runBacktest } from '../src/backtest/engine.js';
import { eventStudy } from '../src/backtest/eventStudy.js';
import { computeMetrics } from '../src/backtest/metrics.js';
import { STRATEGIES, getStrategy } from '../src/backtest/strategies.js';
import type { SignalEvent } from '../src/signals/events.js';
import { makeBars, randomWalk } from './helpers.js';

describe('runBacktest', () => {
  const bars = makeBars([100, 110, 99, 120, 132]);

  it('always-long with no costs matches the price return', () => {
    const run = runBacktest(bars, [1, 1, 1, 1, 1]);
    expect(run.metrics.totalReturn).toBeCloseTo(132 / 100 - 1, 10);
    expect(run.equity.at(-1)?.equity).toBeCloseTo(1.32, 10);
  });

  it('acts on a signal one bar later (no lookahead)', () => {
    // Long only on bar 3's close: it holds over bar 4 (120 -> 132), not bar 3 (99 -> 120).
    const run = runBacktest(bars, [0, 0, 0, 1, 1]);
    expect(run.metrics.totalReturn).toBeCloseTo(132 / 120 - 1, 10);
    expect(run.trades).toHaveLength(1);
    expect(run.trades[0]).toMatchObject({ entryDate: bars[3].date, entryPrice: 120, open: true });
  });

  it('charges costs on entry and exit', () => {
    // Enter at 100, exit at 110: +10% gross, minus 1% each way.
    const run = runBacktest(bars, [1, 0, 0, 0, 0], { costBps: 100 });
    expect(run.metrics.totalReturn).toBeCloseTo(0.99 * 1.1 * 0.99 - 1, 10);
    expect(run.trades[0].return).toBeCloseTo(0.99 * 1.1 * 0.99 - 1, 10);
    expect(run.trades[0].open).toBe(false);
  });

  it('stays flat in cash when never long', () => {
    const run = runBacktest(bars, [0, 0, 0, 0, 0], { costBps: 10 });
    expect(run.metrics.totalReturn).toBe(0);
    expect(run.metrics.exposure).toBe(0);
    expect(run.trades).toHaveLength(0);
    expect(run.metrics.winRate).toBeNull();
  });

  it('rejects mismatched inputs', () => {
    expect(() => runBacktest(bars, [1, 1])).toThrow();
  });
});

describe('computeMetrics', () => {
  it('measures the deepest peak-to-trough drawdown', () => {
    const m = computeMetrics([1, 1.2, 0.9, 1.1, 0.6, 1.5], ['2020-01-01', '2020-01-02', '2020-01-03', '2020-01-06', '2020-01-07', '2020-01-08'], [0, 1, 1, 1, 1, 1]);
    expect(m.maxDrawdown).toBeCloseTo(0.5, 10); // 1.2 -> 0.6
    expect(m.totalReturn).toBeCloseTo(0.5, 10);
  });

  it('annualizes growth over calendar time', () => {
    const m = computeMetrics([1, 1.21], ['2020-01-01', '2022-01-01'], [0, 1]);
    expect(m.cagr).toBeCloseTo(0.1, 2);
  });
});

describe('eventStudy', () => {
  it('measures forward returns against the all-bars baseline', () => {
    const bars = makeBars([100, 100, 100, 100, 100, 100, 110, 110, 110, 110, 110, 110]);
    const event: SignalEvent = { id: 'golden_cross', name: 'Golden cross', label: 'GC', direction: 'bullish', date: bars[1].date, index: 1, close: 100 };
    const golden = eventStudy(bars, [event], 0, [5]).find((s) => s.id === 'golden_cross');
    const h = golden?.horizons[0];
    expect(golden?.occurrences).toBe(1);
    expect(h?.samples).toBe(1);
    expect(h?.avgReturn).toBeCloseTo(0.1, 10); // 100 -> 110
    expect(h?.hitRate).toBe(1);
    // 7 bars have a 5-day forward window; 5 of them (indices 1-5) rise 10%.
    expect(h?.baselineAvgReturn).toBeCloseTo((5 * 0.1) / 7, 10);
    expect(h?.edge).toBeCloseTo(0.1 - (5 * 0.1) / 7, 10);
  });

  it('leaves out events whose horizon runs past the data', () => {
    const bars = makeBars([100, 101, 102, 103]);
    const event: SignalEvent = { id: 'death_cross', name: 'Death cross', label: 'DC', direction: 'bearish', date: bars[2].date, index: 2, close: 102 };
    const stats = eventStudy(bars, [event], 0, [5]).find((s) => s.id === 'death_cross');
    expect(stats?.occurrences).toBe(1);
    expect(stats?.horizons[0].samples).toBe(0);
    expect(stats?.horizons[0].hitRate).toBeNull();
  });
});

describe('backtest (strategy vs buy-and-hold)', () => {
  const bars = makeBars(randomWalk(1200, 5));

  it('runs every strategy over the same window as the benchmark', () => {
    for (const strategy of STRATEGIES) {
      const out = backtest(bars, strategy, { costBps: 5 });
      expect(out.result.equity).toHaveLength(out.benchmark.equity.length);
      expect(out.from).toBe(bars[199].date); // first bar after the 200-day warm-up
      expect(out.benchmark.metrics.exposure).toBe(1);
      expect(out.eventStudy.length).toBeGreaterThan(0);
    }
  });

  it('respects from/to dates', () => {
    const out = backtest(bars, getStrategy('macd')!, { from: bars[400].date, to: bars[800].date });
    expect(out.from).toBe(bars[400].date);
    expect(out.to).toBe(bars[800].date);
  });

  it('refuses to run without enough history', () => {
    expect(() => backtest(makeBars(randomWalk(100)), getStrategy('macd')!)).toThrow(InsufficientDataError);
  });
});
