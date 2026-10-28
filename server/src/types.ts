/** One trading day of OHLCV data. Dates are exchange-local YYYY-MM-DD strings. */
export interface Bar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** A bar as delivered by the data provider, before split/dividend adjustment. */
export interface RawBar extends Bar {
  adjClose: number;
}

/**
 * Indicator output aligned index-for-index with the input bars.
 * `null` marks bars where the indicator is still warming up.
 */
export type Series = (number | null)[];

export type Direction = 'bullish' | 'bearish';
