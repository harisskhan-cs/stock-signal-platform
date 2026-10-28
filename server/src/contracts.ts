/**
 * The REST API's response shapes. The React client imports these types
 * directly, so a change on the server shows up as a type error in the client.
 * Keep this file (and what it imports) free of Node-only modules.
 */
import type { AnalysisResult, BacktestResult } from './analysis.js';
import type { SignalSummary } from './signals/summary.js';
import type { Bar } from './types.js';

export type { AnalysisResult, BacktestResult } from './analysis.js';
export type { BacktestRun, EquityPoint, Trade } from './backtest/engine.js';
export type { EventStats, HorizonStats } from './backtest/eventStudy.js';
export type { PerformanceMetrics } from './backtest/metrics.js';
export type { PriceLevel } from './indicators/supportResistance.js';
export type { SignalEvent } from './signals/events.js';
export type { RuleReading, Stance } from './signals/rules.js';
export type { ContextNote, SignalSummary, Verdict } from './signals/summary.js';
export type { Bar, Direction, Series } from './types.js';

export type CacheSource = 'cache' | 'refreshed' | 'downloaded' | 'stale-cache';

export interface SeriesInfo {
  symbol: string;
  name: string | null;
  currency: string | null;
  exchange: string | null;
  fetchedAt: string;
  /** How this request was served, so the UI can show whether data came from the cache. */
  source: CacheSource;
  warning?: string;
}

export interface SymbolMatch {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
}

export interface StrategyInfo {
  id: string;
  name: string;
  description: string;
}

export interface CachedSymbolInfo {
  symbol: string;
  name: string | null;
  currency: string | null;
  exchange: string | null;
  lastFetchedAt: string;
  firstDate: string | null;
  lastDate: string | null;
  bars: number;
}

/** Where the exchange is in its trading day. */
export type MarketSession = 'pre' | 'regular' | 'post' | 'closed';

/** One intraday (1-minute) price. `time` is a Unix timestamp in seconds. */
export interface IntradayPoint {
  time: number;
  value: number;
  session: 'pre' | 'regular' | 'post';
}

export interface LiveQuote {
  symbol: string;
  session: MarketSession;
  /** Latest regular-session price: the official last trade. */
  price: number;
  /** Close of the session before `price`'s session. */
  previousClose: number;
  change: number;
  changePct: number;
  /** Pre-market or after-hours trading, while it is happening. */
  extended: { session: 'pre' | 'post'; price: number; change: number; changePct: number; time: string } | null;
  /** When the most recent price shown was traded (ISO). */
  lastTradeTime: string;
  /** IANA timezone of the exchange, for formatting times. */
  timeZone: string;
  fetchedAt: string;
}

/** Indicator values on the latest bar, so the chart can move its last points live. */
export interface LiveIndicators {
  date: string;
  sma50: number | null;
  sma200: number | null;
  ema20: number | null;
  rsi14: number | null;
  macd: number | null;
  signal: number | null;
  histogram: number | null;
  bbUpper: number | null;
  bbMiddle: number | null;
  bbLower: number | null;
}

/** One message on the live stream (`GET /api/stream/:symbol`, Server-Sent Events). */
export interface LiveUpdate {
  symbol: string;
  quote: LiveQuote;
  /** Today's daily candle built from intraday trades; null before the regular session opens. */
  todayBar: Bar | null;
  latest: LiveIndicators;
  /** The signal summary recomputed with today's live candle included. */
  summary: SignalSummary;
  /** True if `intraday` is the full day; false if it only holds the newest points to merge in. */
  snapshot: boolean;
  intraday: IntradayPoint[];
}

/** A row in the watchlist: a cached symbol with its latest close and daily change. */
export interface WatchlistEntry {
  symbol: string;
  name: string | null;
  currency: string | null;
  date: string;
  last: number;
  changePct: number | null;
}

export type PricesResponse = SeriesInfo & { bars: Bar[] };
export type AnalysisResponse = SeriesInfo & AnalysisResult;
export type BacktestResponse = SeriesInfo & BacktestResult;
export interface ErrorResponse {
  error: string;
}
