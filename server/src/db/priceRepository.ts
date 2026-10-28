import type { WatchlistEntry } from '../contracts.js';
import type { RawBar } from '../types.js';
import type { Db, Queryable } from './index.js';

export interface SymbolMeta {
  symbol: string;
  name: string | null;
  currency: string | null;
  exchange: string | null;
}

export interface CachedSymbol extends SymbolMeta {
  lastFetchedAt: Date;
  firstDate: string | null;
  lastDate: string | null;
  bars: number;
}

interface SymbolRow {
  symbol: string;
  name: string | null;
  currency: string | null;
  exchange: string | null;
  last_fetched_at: Date | string;
  first_date: string | null;
  last_date: string | null;
  bars: number;
}

/** Rows per INSERT. 8 columns x 500 rows = 4,000 parameters, well under Postgres' 65,535 limit. */
const CHUNK = 500;

const SYMBOL_SELECT = `
  SELECT s.symbol, s.name, s.currency, s.exchange, s.last_fetched_at,
         MIN(p.trade_date)::text AS first_date,
         MAX(p.trade_date)::text AS last_date,
         COUNT(p.trade_date)::int AS bars
    FROM symbols s
    LEFT JOIN daily_prices p ON p.symbol = s.symbol`;

export class PriceRepository {
  constructor(private readonly db: Db) {}

  async getSymbol(symbol: string): Promise<CachedSymbol | null> {
    const rows = await this.db.query<SymbolRow>(`${SYMBOL_SELECT} WHERE s.symbol = $1 GROUP BY s.symbol`, [symbol]);
    return rows[0] ? toCachedSymbol(rows[0]) : null;
  }

  async listSymbols(): Promise<CachedSymbol[]> {
    const rows = await this.db.query<SymbolRow>(`${SYMBOL_SELECT} GROUP BY s.symbol ORDER BY s.last_fetched_at DESC`);
    return rows.map(toCachedSymbol);
  }

  /**
   * Every cached symbol with its last two closes, most recently viewed first.
   * LATERAL runs the "latest two bars" lookup once per symbol using the
   * (symbol, trade_date) primary key, instead of scanning all prices.
   */
  async watchlist(): Promise<WatchlistEntry[]> {
    const rows = await this.db.query<{ symbol: string; name: string | null; currency: string | null; date: string; close: number; adj: number }>(
      `SELECT s.symbol, s.name, s.currency, p.trade_date::text AS date, p.close, p.adj_close AS adj
         FROM symbols s
         JOIN LATERAL (
           SELECT trade_date, close, adj_close FROM daily_prices d
            WHERE d.symbol = s.symbol
            ORDER BY trade_date DESC
            LIMIT 2
         ) p ON true
        ORDER BY s.last_fetched_at DESC, s.symbol, p.trade_date DESC`,
    );
    const items: (WatchlistEntry & { adjLast: number })[] = [];
    for (const row of rows) {
      const current = items.at(-1);
      if (current?.symbol === row.symbol) {
        // Second (older) row: adjusted closes keep the change correct across ex-dividend days.
        current.changePct = current.adjLast / row.adj - 1;
        continue;
      }
      items.push({ symbol: row.symbol, name: row.name, currency: row.currency, date: row.date, last: row.close, adjLast: row.adj, changePct: null });
    }
    return items.map(({ adjLast: _adj, ...item }) => item);
  }

  async getBars(symbol: string): Promise<RawBar[]> {
    // ::text keeps dates as YYYY-MM-DD strings instead of timezone-shifted JS Dates.
    return this.db.query<RawBar>(
      `SELECT trade_date::text AS date, open, high, low, close, adj_close AS "adjClose", volume
         FROM daily_prices
        WHERE symbol = $1
        ORDER BY trade_date`,
      [symbol],
    );
  }

  /**
   * Stores a download atomically. `replace` swaps out the symbol's whole
   * history (needed after a split or dividend, which re-adjusts every past
   * price); `merge` upserts only the bars it is given.
   */
  async save(meta: SymbolMeta, bars: readonly RawBar[], mode: 'replace' | 'merge', fetchedAt: Date): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO symbols (symbol, name, currency, exchange, last_fetched_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (symbol) DO UPDATE
           SET name = COALESCE(EXCLUDED.name, symbols.name),
               currency = COALESCE(EXCLUDED.currency, symbols.currency),
               exchange = COALESCE(EXCLUDED.exchange, symbols.exchange),
               last_fetched_at = EXCLUDED.last_fetched_at`,
        [meta.symbol, meta.name, meta.currency, meta.exchange, fetchedAt.toISOString()],
      );
      if (mode === 'replace') await tx.query('DELETE FROM daily_prices WHERE symbol = $1', [meta.symbol]);
      for (let i = 0; i < bars.length; i += CHUNK) await upsertChunk(tx, meta.symbol, bars.slice(i, i + CHUNK));
    });
  }
}

async function upsertChunk(tx: Queryable, symbol: string, bars: readonly RawBar[]): Promise<void> {
  const params: unknown[] = [];
  const tuples = bars.map((b) => {
    const base = params.length;
    params.push(symbol, b.date, b.open, b.high, b.low, b.close, b.adjClose, b.volume);
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`;
  });
  await tx.query(
    `INSERT INTO daily_prices (symbol, trade_date, open, high, low, close, adj_close, volume)
     VALUES ${tuples.join(', ')}
     ON CONFLICT (symbol, trade_date) DO UPDATE
       SET open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
           close = EXCLUDED.close, adj_close = EXCLUDED.adj_close, volume = EXCLUDED.volume`,
    params,
  );
}

function toCachedSymbol(row: SymbolRow): CachedSymbol {
  return {
    symbol: row.symbol,
    name: row.name,
    currency: row.currency,
    exchange: row.exchange,
    lastFetchedAt: new Date(row.last_fetched_at),
    firstDate: row.first_date,
    lastDate: row.last_date,
    bars: Number(row.bars),
  };
}
