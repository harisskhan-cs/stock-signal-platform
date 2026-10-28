import type { IntradayPoint, MarketSession } from '../contracts.js';
import type { Bar, RawBar } from '../types.js';
import {
  ProviderError,
  SymbolNotFoundError,
  type DailyHistory,
  type IntradaySnapshot,
  type PriceProvider,
  type SymbolMatch,
} from './provider.js';

const USER_AGENT = 'Mozilla/5.0 (compatible; stock-signal-platform/0.1)';
const TIMEOUT_MS = 15_000;

/** The subset of Yahoo's v8 chart response this app reads. */
export interface YahooChartResult {
  meta: {
    symbol: string;
    longName?: string;
    shortName?: string;
    currency?: string;
    fullExchangeName?: string;
    exchangeName?: string;
    exchangeTimezoneName?: string;
    regularMarketPrice?: number;
    regularMarketTime?: number;
    regularMarketDayHigh?: number;
    regularMarketDayLow?: number;
    regularMarketVolume?: number;
    chartPreviousClose?: number;
    previousClose?: number;
    hasPrePostMarketData?: boolean;
    currentTradingPeriod?: { pre: TradingPeriod; regular: TradingPeriod; post: TradingPeriod };
  };
  timestamp?: number[];
  events?: { dividends?: Record<string, unknown>; splits?: Record<string, unknown> };
  indicators: {
    quote: { open: (number | null)[]; high: (number | null)[]; low: (number | null)[]; close: (number | null)[]; volume: (number | null)[] }[];
    adjclose?: { adjclose: (number | null)[] }[];
  };
}

export interface TradingPeriod {
  start: number;
  end: number;
  gmtoffset: number;
}

interface YahooChartResponse {
  chart?: { result?: YahooChartResult[] | null; error?: { code: string; description: string } | null };
}

interface YahooSearchResponse {
  quotes?: { symbol?: string; shortname?: string; longname?: string; exchDisp?: string; quoteType?: string; typeDisp?: string }[];
}

/**
 * Daily prices from Yahoo Finance's public chart endpoint. No API key is
 * needed, but it is unofficial, which is why everything goes through the
 * PostgreSQL cache and the app keeps serving cached data if Yahoo is down.
 */
export class YahooProvider implements PriceProvider {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly baseUrl = 'https://query1.finance.yahoo.com',
  ) {}

  async fetchDaily(symbol: string, from: Date, to: Date): Promise<DailyHistory> {
    const params = new URLSearchParams({
      period1: String(Math.floor(from.getTime() / 1000)),
      period2: String(Math.floor(to.getTime() / 1000)),
      interval: '1d',
      events: 'div,splits',
      includeAdjustedClose: 'true',
    });
    return parseChart(await this.chart(symbol, params));
  }

  /** Today's 1-minute bars including pre-market and after-hours trading. */
  async fetchIntraday(symbol: string): Promise<IntradaySnapshot> {
    const params = new URLSearchParams({ interval: '1m', range: '1d', includePrePost: 'true' });
    return parseIntraday(await this.chart(symbol, params), Date.now() / 1000);
  }

  private async chart(symbol: string, params: URLSearchParams): Promise<YahooChartResult> {
    const body = await this.get<YahooChartResponse>(`/v8/finance/chart/${encodeURIComponent(symbol)}?${params}`, symbol);
    const error = body.chart?.error;
    if (error) {
      if (error.code === 'Not Found') throw new SymbolNotFoundError(symbol);
      throw new ProviderError(`Yahoo Finance: ${error.description}`);
    }
    const result = body.chart?.result?.[0];
    if (!result) throw new SymbolNotFoundError(symbol);
    return result;
  }

  async search(query: string): Promise<SymbolMatch[]> {
    const params = new URLSearchParams({ q: query, quotesCount: '8', newsCount: '0', listsCount: '0' });
    const body = await this.get<YahooSearchResponse>(`/v1/finance/search?${params}`);
    return (body.quotes ?? [])
      .filter((q) => q.symbol && ['EQUITY', 'ETF', 'INDEX', 'CRYPTOCURRENCY'].includes(q.quoteType ?? ''))
      .map((q) => ({
        symbol: q.symbol as string,
        name: q.longname ?? q.shortname ?? (q.symbol as string),
        exchange: q.exchDisp ?? '',
        type: q.typeDisp ?? q.quoteType ?? '',
      }));
  }

  private async get<T>(path: string, symbol?: string): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new ProviderError(`Could not reach Yahoo Finance: ${(err as Error).message}`);
    }
    if (res.status === 404 && symbol) throw new SymbolNotFoundError(symbol);
    if (res.status === 429) throw new ProviderError('Yahoo Finance rate limit hit; try again in a minute.');
    if (!res.ok) throw new ProviderError(`Yahoo Finance returned HTTP ${res.status}`);
    return (await res.json()) as T;
  }
}

/** Converts Yahoo's column arrays into bars, dropping days with missing prices. */
export function parseChart(result: YahooChartResult): DailyHistory {
  const { meta } = result;
  const timestamps = result.timestamp ?? [];
  const quote = result.indicators.quote[0];
  const adj = result.indicators.adjclose?.[0]?.adjclose;
  const toDate = localDateFormatter(meta.exchangeTimezoneName);

  const byDate = new Map<string, RawBar>();
  timestamps.forEach((ts, i) => {
    const open = quote?.open[i];
    const high = quote?.high[i];
    const low = quote?.low[i];
    const close = quote?.close[i];
    if (open == null || high == null || low == null || close == null || close <= 0) return;
    // Later rows win: Yahoo sometimes repeats today's in-progress bar.
    byDate.set(toDate(ts), {
      date: toDate(ts),
      open,
      high,
      low,
      close,
      adjClose: adj?.[i] ?? close,
      volume: quote.volume[i] ?? 0,
    });
  });

  const events = result.events ?? {};
  return {
    meta: {
      symbol: meta.symbol.toUpperCase(),
      name: meta.longName ?? meta.shortName ?? null,
      currency: meta.currency ?? null,
      exchange: meta.fullExchangeName ?? meta.exchangeName ?? null,
    },
    bars: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    corporateActions: Object.keys(events.dividends ?? {}).length > 0 || Object.keys(events.splits ?? {}).length > 0,
  };
}

const DAY = 86_400;
/** Seconds since local midnight, given a period's UTC offset. */
const timeOfDay = (ts: number, gmtoffset: number) => (((ts + gmtoffset) % DAY) + DAY) % DAY;
const within = (ts: number, p: TradingPeriod) => ts >= p.start && ts < p.end;

/**
 * Parses a 1-minute chart into the current session state.
 *
 * Yahoo reports the exchange's pre/regular/post windows for the current
 * trading day. Points are classified by time of day against those windows
 * (rather than by absolute time) so that yesterday's bars, which Yahoo still
 * returns before today's session starts, are labelled correctly too.
 */
export function parseIntraday(result: YahooChartResult, nowSec: number): IntradaySnapshot {
  const { meta } = result;
  const timeZone = meta.exchangeTimezoneName ?? 'America/New_York';
  const toDate = localDateFormatter(timeZone);
  const periods = meta.currentTradingPeriod;
  const quote = result.indicators.quote[0];
  const timestamps = result.timestamp ?? [];

  const sessionOf = (ts: number): IntradayPoint['session'] => {
    if (!periods) return 'regular';
    const { pre, regular } = periods;
    const t = timeOfDay(ts, regular.gmtoffset);
    if (t < timeOfDay(pre.end, pre.gmtoffset)) return 'pre';
    if (t < timeOfDay(regular.end, regular.gmtoffset)) return 'regular';
    return 'post';
  };

  const points: IntradayPoint[] = [];
  const regularRows: { ts: number; open: number; high: number; low: number; close: number; volume: number }[] = [];
  timestamps.forEach((ts, i) => {
    const close = quote?.close[i];
    if (close == null || close <= 0) return;
    const session = sessionOf(ts);
    points.push({ time: ts, value: close, session });
    if (session === 'regular') {
      regularRows.push({
        ts,
        open: quote.open[i] ?? close,
        high: quote.high[i] ?? close,
        low: quote.low[i] ?? close,
        close,
        volume: quote.volume[i] ?? 0,
      });
    }
  });

  let session: MarketSession = 'closed';
  if (periods) {
    if (within(nowSec, periods.pre)) session = 'pre';
    else if (within(nowSec, periods.regular)) session = 'regular';
    else if (within(nowSec, periods.post)) session = 'post';
    // Exchanges without extended-hours trading (e.g. the TSX) still report pre/post windows.
    if ((session === 'pre' || session === 'post') && meta.hasPrePostMarketData === false) session = 'closed';
    // Holidays: the window says "open" but nothing has traded half an hour in.
    if (session === 'regular' && nowSec - periods.regular.start > 1800 && !points.some((p) => p.time >= periods.regular.start)) {
      session = 'closed';
    }
  }

  const regularPrice = meta.regularMarketPrice ?? regularRows.at(-1)?.close ?? points.at(-1)?.value ?? 0;
  const regularTime = meta.regularMarketTime ?? regularRows.at(-1)?.ts ?? 0;

  // The latest regular session as one daily candle. Yahoo's own day high/low/volume
  // are preferred when they describe the same day, since 1-minute bars miss auctions.
  let sessionBar: Bar | null = null;
  const lastDay = regularRows.length ? toDate(regularRows[regularRows.length - 1].ts) : null;
  if (lastDay) {
    const day = regularRows.filter((r) => toDate(r.ts) === lastDay);
    const sameDay = meta.regularMarketTime != null && toDate(meta.regularMarketTime) === lastDay;
    const high = Math.max(...day.map((r) => r.high));
    const low = Math.min(...day.map((r) => r.low));
    sessionBar = {
      date: lastDay,
      open: day[0].open,
      high: sameDay && meta.regularMarketDayHigh != null ? Math.max(high, meta.regularMarketDayHigh) : high,
      low: sameDay && meta.regularMarketDayLow != null ? Math.min(low, meta.regularMarketDayLow) : low,
      close: sameDay ? regularPrice : day[day.length - 1].close,
      volume: sameDay && meta.regularMarketVolume != null ? meta.regularMarketVolume : day.reduce((a, r) => a + r.volume, 0),
    };
  }

  let extended: IntradaySnapshot['extended'] = null;
  if (periods && (session === 'pre' || session === 'post')) {
    const window = periods[session];
    const last = [...points].reverse().find((p) => p.session === session && p.time >= window.start);
    if (last) extended = { session, price: last.value, time: last.time };
  }

  return {
    symbol: meta.symbol.toUpperCase(),
    timeZone,
    session,
    regularPrice,
    regularTime,
    previousClose: meta.chartPreviousClose ?? meta.previousClose ?? regularPrice,
    sessionBar,
    extended,
    points,
  };
}

/**
 * Yahoo timestamps daily bars at the market open in UTC. Converting in the
 * exchange's own timezone gives the trading date (UTC would be off by a day
 * for Asian markets).
 */
export function localDateFormatter(timeZone = 'America/New_York'): (ts: number) => string {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return (ts) => fmt.format(new Date(ts * 1000));
}
