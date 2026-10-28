import type { Bar } from '../types.js';
import { computeMetrics, type PerformanceMetrics } from './metrics.js';

export interface Trade {
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  /** Net of transaction costs on both sides. */
  return: number;
  bars: number;
  /** True if the position was still open on the last bar (marked to market). */
  open: boolean;
}

export interface EquityPoint {
  date: string;
  equity: number;
}

export interface BacktestRun {
  metrics: PerformanceMetrics & { trades: number; winRate: number | null };
  equity: EquityPoint[];
  trades: Trade[];
}

export interface EngineOptions {
  /** One-way cost per trade in basis points (commission + slippage). 5 bps = 0.05%. */
  costBps?: number;
}

/**
 * Simulates holding the target positions over the given bars.
 *
 * Timing (the important part): `targets[i]` is decided with bar i's close, so
 * it can only be traded at that close and earns bar i + 1's return. In code,
 * the position held over bar i is `targets[i - 1]`. Using `targets[i]` instead
 * would let a strategy profit from a move it only learns about after the fact.
 *
 * Costs are charged on every change in position, as a fraction of equity.
 */
export function runBacktest(bars: readonly Bar[], targets: readonly number[], options: EngineOptions = {}): BacktestRun {
  if (bars.length !== targets.length) throw new Error('bars and targets must be the same length');
  if (bars.length < 2) throw new Error('need at least two bars to backtest');
  const costRate = (options.costBps ?? 0) / 10_000;

  let equity = 1;
  let pos = 0;
  const curve: EquityPoint[] = [{ date: bars[0].date, equity }];
  const held: number[] = [0];
  const trades: Trade[] = [];
  let entry: { index: number; equity: number } | null = null;

  for (let i = 1; i < bars.length; i++) {
    const target = targets[i - 1];
    if (target !== pos) {
      equity *= 1 - costRate * Math.abs(target - pos);
      if (pos === 0) {
        // Entry is recorded before the entry cost so the trade's return includes it.
        entry = { index: i - 1, equity: equity / (1 - costRate) };
      } else if (entry) {
        trades.push(closeTrade(bars, entry, i - 1, equity, false));
        entry = null;
      }
      pos = target;
    }
    equity *= 1 + pos * (bars[i].close / bars[i - 1].close - 1);
    curve.push({ date: bars[i].date, equity });
    held.push(pos);
  }
  if (entry) trades.push(closeTrade(bars, entry, bars.length - 1, equity, true));

  const metrics = computeMetrics(
    curve.map((p) => p.equity),
    curve.map((p) => p.date),
    held,
  );
  const closed = trades.filter((t) => !t.open);
  const winRate = closed.length ? closed.filter((t) => t.return > 0).length / closed.length : null;

  return { metrics: { ...metrics, trades: trades.length, winRate }, equity: curve, trades };
}

function closeTrade(bars: readonly Bar[], entry: { index: number; equity: number }, exitIndex: number, exitEquity: number, open: boolean): Trade {
  return {
    entryDate: bars[entry.index].date,
    entryPrice: bars[entry.index].close,
    exitDate: bars[exitIndex].date,
    exitPrice: bars[exitIndex].close,
    return: exitEquity / entry.equity - 1,
    bars: exitIndex - entry.index,
    open,
  };
}
