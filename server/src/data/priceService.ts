import type { CacheSource, SeriesInfo } from '../contracts.js';
import type { CachedSymbol, PriceRepository } from '../db/priceRepository.js';
import type { Bar, RawBar } from '../types.js';
import { SymbolNotFoundError, type PriceProvider } from './provider.js';

export class InvalidSymbolError extends Error {}

export interface PriceSeries extends SeriesInfo {
  /** Split- and dividend-adjusted bars, oldest first. */
  bars: Bar[];
}

export interface PriceServiceOptions {
  /** Cached data younger than this is served without calling the provider. */
  ttlMs: number;
  /** How far back the first download goes. */
  historyYears: number;
  now?: () => Date;
}

/** Days re-downloaded on a refresh so the last cached bar (possibly mid-session) gets its final values. */
const REFRESH_OVERLAP_DAYS = 5;

const SYMBOL_PATTERN = /^[A-Z0-9^][A-Z0-9.\-=^]{0,19}$/;

export function normalizeSymbol(input: string): string {
  const symbol = input.trim().toUpperCase();
  if (!SYMBOL_PATTERN.test(symbol)) throw new InvalidSymbolError(`"${input}" is not a valid ticker symbol`);
  return symbol;
}

/**
 * Cache-aside access to daily prices, backed by PostgreSQL.
 *
 * - Fresh cache (younger than the TTL): served straight from the database.
 * - Stale cache: only the last few days are downloaded and merged in. If a
 *   split or dividend happened in that window, the whole history is
 *   re-downloaded, because adjusted prices change retroactively.
 * - Not cached: the full history is downloaded and stored.
 * - Provider down: stale cached data is served with a warning instead of an error.
 *
 * Concurrent requests for the same symbol share one in-flight load, so ten
 * browser tabs opening AAPL at once cause one download, not ten.
 */
export class PriceService {
  private readonly inflight = new Map<string, Promise<PriceSeries>>();
  private readonly now: () => Date;

  constructor(
    private readonly repo: PriceRepository,
    private readonly provider: PriceProvider,
    private readonly options: PriceServiceOptions,
  ) {
    this.now = options.now ?? (() => new Date());
  }

  get(symbolInput: string): Promise<PriceSeries> {
    const symbol = normalizeSymbol(symbolInput);
    const pending = this.inflight.get(symbol);
    if (pending) return pending;
    const load = this.load(symbol).finally(() => this.inflight.delete(symbol));
    this.inflight.set(symbol, load);
    return load;
  }

  private async load(symbol: string): Promise<PriceSeries> {
    const now = this.now();
    const cached = await this.repo.getSymbol(symbol);
    const hasBars = cached != null && cached.bars > 0;

    if (hasBars && now.getTime() - cached.lastFetchedAt.getTime() < this.options.ttlMs) {
      return this.read(cached, 'cache');
    }

    try {
      if (hasBars && cached.lastDate) {
        const from = new Date(`${cached.lastDate}T00:00:00Z`);
        from.setUTCDate(from.getUTCDate() - REFRESH_OVERLAP_DAYS);
        const recent = await this.provider.fetchDaily(symbol, from, now);
        if (recent.corporateActions) {
          const full = await this.provider.fetchDaily(symbol, this.historyStart(now), now);
          await this.repo.save({ ...full.meta, symbol }, full.bars, 'replace', now);
        } else {
          await this.repo.save({ ...recent.meta, symbol }, recent.bars, 'merge', now);
        }
        return this.read(await this.mustGet(symbol), 'refreshed');
      }

      const full = await this.provider.fetchDaily(symbol, this.historyStart(now), now);
      if (full.bars.length === 0) throw new SymbolNotFoundError(symbol);
      await this.repo.save({ ...full.meta, symbol }, full.bars, 'replace', now);
      return this.read(await this.mustGet(symbol), 'downloaded');
    } catch (err) {
      if (hasBars && !(err instanceof SymbolNotFoundError)) {
        const series = await this.read(cached, 'stale-cache');
        series.warning = `Live data is unavailable (${(err as Error).message}), so this uses cached prices from ${cached.lastFetchedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC.`;
        return series;
      }
      throw err;
    }
  }

  private historyStart(now: Date): Date {
    const start = new Date(now);
    start.setUTCFullYear(start.getUTCFullYear() - this.options.historyYears);
    return start;
  }

  private async mustGet(symbol: string): Promise<CachedSymbol> {
    const info = await this.repo.getSymbol(symbol);
    if (!info) throw new Error(`Symbol ${symbol} missing from cache after save`);
    return info;
  }

  private async read(info: CachedSymbol, source: CacheSource): Promise<PriceSeries> {
    const raw = await this.repo.getBars(info.symbol);
    return {
      symbol: info.symbol,
      name: info.name,
      currency: info.currency,
      exchange: info.exchange,
      fetchedAt: info.lastFetchedAt.toISOString(),
      source,
      bars: raw.map(adjust),
    };
  }
}

/**
 * Scales open/high/low/close by adjClose / close, so a 4-for-1 split shows up
 * as a continuous line instead of a 75% crash, and dividends are counted as
 * returns. Every indicator and backtest runs on adjusted prices.
 */
export function adjust(bar: RawBar): Bar {
  const factor = bar.close > 0 ? bar.adjClose / bar.close : 1;
  return {
    date: bar.date,
    open: bar.open * factor,
    high: bar.high * factor,
    low: bar.low * factor,
    close: bar.adjClose,
    volume: bar.volume,
  };
}
