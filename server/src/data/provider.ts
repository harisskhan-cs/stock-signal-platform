import type { IntradayPoint, MarketSession, SymbolMatch } from '../contracts.js';
import type { SymbolMeta } from '../db/priceRepository.js';
import type { Bar, RawBar } from '../types.js';

export type { SymbolMatch } from '../contracts.js';

export interface DailyHistory {
  meta: SymbolMeta;
  bars: RawBar[];
  /**
   * True if a split or dividend happened inside the requested window. Either
   * one changes the adjusted price of every earlier bar, so the cache has to
   * re-download the full history instead of appending.
   */
  corporateActions: boolean;
}

/** The current trading day at 1-minute resolution, plus the exchange's session state. */
export interface IntradaySnapshot {
  symbol: string;
  timeZone: string;
  session: MarketSession;
  /** Official last regular-session trade and when it happened (Unix seconds). */
  regularPrice: number;
  regularTime: number;
  previousClose: number;
  /** The latest regular session as a daily candle, built from its 1-minute bars. */
  sessionBar: Bar | null;
  /** The latest pre-market or after-hours trade, while that session is running. */
  extended: { session: 'pre' | 'post'; price: number; time: number } | null;
  points: IntradayPoint[];
}

/** Where prices come from. Yahoo is the default; tests use an in-memory fake. */
export interface PriceProvider {
  fetchDaily(symbol: string, from: Date, to: Date): Promise<DailyHistory>;
  fetchIntraday(symbol: string): Promise<IntradaySnapshot>;
  search(query: string): Promise<SymbolMatch[]>;
}

export class SymbolNotFoundError extends Error {
  constructor(readonly symbol: string) {
    super(`No price data found for "${symbol}". Check the ticker (e.g. AAPL, SHOP.TO, BRK-B).`);
  }
}

/** The upstream data source failed (network error, rate limit, bad response). */
export class ProviderError extends Error {}
