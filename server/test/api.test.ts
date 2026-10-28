import type { AddressInfo } from 'node:net';
import http from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { LiveUpdate } from '../src/contracts.js';
import { PriceService } from '../src/data/priceService.js';
import {
  ProviderError,
  SymbolNotFoundError,
  type DailyHistory,
  type IntradaySnapshot,
  type PriceProvider,
  type SymbolMatch,
} from '../src/data/provider.js';
import { createDb, type Db } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { PriceRepository } from '../src/db/priceRepository.js';
import { LiveHub } from '../src/live/liveHub.js';
import type { RawBar } from '../src/types.js';
import { makeBars, randomWalk, toRaw } from './helpers.js';

/** Serves a fixed synthetic history for TEST and records every call. */
class FakeProvider implements PriceProvider {
  history: RawBar[] = toRaw(makeBars(randomWalk(1200, 9), '2020-01-01'));
  calls: { symbol: string; from: string; to: string }[] = [];
  fail = false;
  corporateActions = false;

  async fetchDaily(symbol: string, from: Date, to: Date): Promise<DailyHistory> {
    this.calls.push({ symbol, from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) });
    await new Promise((r) => setTimeout(r, 5));
    if (this.fail) throw new ProviderError('upstream timeout');
    if (symbol !== 'TEST') throw new SymbolNotFoundError(symbol);
    const lo = from.toISOString().slice(0, 10);
    const hi = to.toISOString().slice(0, 10);
    return {
      meta: { symbol, name: 'Test Corp', currency: 'USD', exchange: 'TESTX' },
      bars: this.history.filter((b) => b.date >= lo && b.date <= hi),
      corporateActions: this.corporateActions,
    };
  }

  async fetchIntraday(symbol: string): Promise<IntradaySnapshot> {
    if (symbol !== 'TEST') throw new SymbolNotFoundError(symbol);
    const last = this.history[this.history.length - 1];
    const price = last.close * 1.01;
    return {
      symbol,
      timeZone: 'America/New_York',
      session: 'regular',
      regularPrice: price,
      regularTime: 1_725_040_000,
      previousClose: last.close,
      sessionBar: { date: '2024-09-03', open: last.close, high: price, low: last.close, close: price, volume: 1000 },
      extended: null,
      points: [
        { time: 1_725_039_940, value: last.close, session: 'regular' },
        { time: 1_725_040_000, value: price, session: 'regular' },
      ],
    };
  }

  async search(query: string): Promise<SymbolMatch[]> {
    return [{ symbol: 'TEST', name: `Test Corp (${query})`, exchange: 'TESTX', type: 'Equity' }];
  }
}

// CI also runs this file against a real PostgreSQL server via TEST_DATABASE_URL.
const target = process.env.TEST_DATABASE_URL ?? 'memory://';

let db: Db;
let provider: FakeProvider;
let now: Date;
let app: ReturnType<typeof createApp>;
let live: LiveHub;
const HOUR = 3_600_000;

beforeAll(async () => {
  db = await createDb(target);
  await migrate(db);
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.query('TRUNCATE symbols CASCADE');
  provider = new FakeProvider();
  now = new Date('2024-08-30T20:00:00Z'); // just after the synthetic history ends
  const repo = new PriceRepository(db);
  const prices = new PriceService(repo, provider, { ttlMs: HOUR, historyYears: 10, now: () => now });
  live = new LiveHub(prices, provider);
  app = createApp({ prices, provider, repo, live, log: false });
});

describe('GET /api/analysis/:symbol', () => {
  it('downloads on first request, then serves from the PostgreSQL cache', async () => {
    const first = await request(app).get('/api/analysis/test').expect(200);
    expect(first.body.symbol).toBe('TEST');
    expect(first.body.source).toBe('downloaded');
    expect(first.body.bars).toHaveLength(1200);
    expect(first.body.indicators.sma200).toHaveLength(1200);
    expect(first.body.summary.readings).toHaveLength(5);
    expect(first.body.summary.verdict).toMatch(/bullish|bearish|neutral/i);

    const second = await request(app).get('/api/analysis/TEST').expect(200);
    expect(second.body.source).toBe('cache');
    expect(second.body.summary).toEqual(first.body.summary);
    expect(provider.calls).toHaveLength(1);
  });

  it('cuts the response to the requested range but keeps indicators warmed up', async () => {
    const res = await request(app).get('/api/analysis/TEST?from=2024-01-01').expect(200);
    expect(res.body.bars[0].date >= '2024-01-01').toBe(true);
    expect(res.body.bars.length).toBeLessThan(200);
    expect(res.body.indicators.sma200[0]).not.toBeNull();
  });

  it('returns 404 for unknown symbols and 400 for malformed ones', async () => {
    const missing = await request(app).get('/api/analysis/NOPE').expect(404);
    expect(missing.body.error).toMatch(/No price data found/);
    await request(app).get('/api/analysis/bad$ymbol').expect(400);
    await request(app).get('/api/analysis/TEST?from=yesterday').expect(400);
  });
});

describe('price cache', () => {
  it('refreshes only recent days once the cache is stale', async () => {
    await request(app).get('/api/prices/TEST').expect(200);
    now = new Date(now.getTime() + 2 * HOUR);
    const res = await request(app).get('/api/prices/TEST').expect(200);
    expect(res.body.source).toBe('refreshed');
    expect(provider.calls).toHaveLength(2);
    // The refresh starts 5 days before the last cached bar, not 10 years back.
    const fiveDaysBefore = new Date(`${provider.history.at(-1)?.date}T00:00:00Z`);
    fiveDaysBefore.setUTCDate(fiveDaysBefore.getUTCDate() - 5);
    expect(provider.calls[1].from).toBe(fiveDaysBefore.toISOString().slice(0, 10));
  });

  it('re-downloads full history when a split or dividend appears', async () => {
    await request(app).get('/api/prices/TEST').expect(200);
    now = new Date(now.getTime() + 2 * HOUR);
    provider.corporateActions = true;
    provider.history = provider.history.map((b) => ({ ...b, adjClose: b.close / 2 })); // e.g. a 2-for-1 split
    const res = await request(app).get('/api/prices/TEST').expect(200);
    expect(provider.calls).toHaveLength(3); // initial, recent window, full re-download
    expect(res.body.bars[0].close).toBeCloseTo(provider.history[0].close / 2, 6);
    expect(res.body.bars).toHaveLength(1200);
  });

  it('serves stale cache with a warning when the provider is down', async () => {
    await request(app).get('/api/prices/TEST').expect(200);
    now = new Date(now.getTime() + 2 * HOUR);
    provider.fail = true;
    const res = await request(app).get('/api/prices/TEST').expect(200);
    expect(res.body.source).toBe('stale-cache');
    expect(res.body.warning).toMatch(/upstream timeout/);
  });

  it('returns 502 when the provider is down and nothing is cached', async () => {
    provider.fail = true;
    const res = await request(app).get('/api/prices/TEST').expect(502);
    expect(res.body.error).toMatch(/upstream timeout/);
  });

  it('shares one download between concurrent requests', async () => {
    const responses = await Promise.all([1, 2, 3, 4, 5].map(() => request(app).get('/api/prices/TEST')));
    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(provider.calls).toHaveLength(1);
  });

  it('returns the watchlist with latest close and daily change', async () => {
    await request(app).get('/api/prices/TEST').expect(200);
    const res = await request(app).get('/api/watchlist').expect(200);
    const [last, prev] = provider.history.slice(-2).reverse();
    expect(res.body).toEqual([
      { symbol: 'TEST', name: 'Test Corp', currency: 'USD', date: last.date, last: last.close, changePct: expect.any(Number) },
    ]);
    expect(res.body[0].changePct).toBeCloseTo(last.adjClose / prev.adjClose - 1, 10);
  });

  it('lists cached symbols with their date coverage', async () => {
    await request(app).get('/api/prices/TEST').expect(200);
    const res = await request(app).get('/api/symbols').expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ symbol: 'TEST', name: 'Test Corp', bars: 1200, firstDate: '2020-01-01' });
  });
});

describe('GET /api/backtest/:symbol', () => {
  it('compares a strategy with buy-and-hold over the same window', async () => {
    const res = await request(app).get('/api/backtest/TEST?strategy=macd&costBps=10').expect(200);
    expect(res.body.strategy.id).toBe('macd');
    expect(res.body.costBps).toBe(10);
    expect(res.body.result.equity).toHaveLength(res.body.benchmark.equity.length);
    expect(res.body.result.metrics).toHaveProperty('sharpe');
    expect(res.body.benchmark.metrics.exposure).toBe(1);
    expect(res.body.eventStudy.find((e: { id: string }) => e.id === 'macd_bull_cross').occurrences).toBeGreaterThan(0);
  });

  it('validates the strategy and cost parameters', async () => {
    const unknown = await request(app).get('/api/backtest/TEST?strategy=moon').expect(400);
    expect(unknown.body.error).toMatch(/Unknown strategy/);
    await request(app).get('/api/backtest/TEST?costBps=-1').expect(400);
  });
});

describe('other routes', () => {
  it('lists strategies, searches and reports health', async () => {
    const strategies = await request(app).get('/api/strategies').expect(200);
    expect(strategies.body.map((s: { id: string }) => s.id)).toContain('composite');
    const search = await request(app).get('/api/search?q=test').expect(200);
    expect(search.body[0].symbol).toBe('TEST');
    await request(app).get('/api/search').expect(400);
    await request(app).get('/api/health').expect(200, { status: 'ok' });
    await request(app).get('/api/nope').expect(404);
  });
});

describe('GET /api/stream/:symbol (live, Server-Sent Events)', () => {
  /** Opens the stream, returns the first `update` event, then disconnects. */
  async function firstUpdate(): Promise<{ contentType: string; update: LiveUpdate }> {
    const server = app.listen(0);
    const { port } = server.address() as AddressInfo;
    try {
      return await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/api/stream/TEST`, (res) => {
          let buffer = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            buffer += chunk;
            const match = /event: update\ndata: (.*)\n\n/.exec(buffer);
            if (match) {
              resolve({ contentType: String(res.headers['content-type']), update: JSON.parse(match[1]) });
              req.destroy();
            }
          });
        });
        req.on('error', (err) => {
          if (!('code' in err && err.code === 'ECONNRESET')) reject(err);
        });
      });
    } finally {
      server.closeAllConnections();
      server.close();
    }
  }

  it('streams live quotes with recomputed signals', async () => {
    const { contentType, update } = await firstUpdate();
    expect(contentType).toMatch(/text\/event-stream/);
    expect(update.symbol).toBe('TEST');
    expect(update.quote.session).toBe('regular');
    expect(update.quote.changePct).toBeCloseTo(0.01, 10);
    expect(update.todayBar?.date).toBe('2024-09-03');
    expect(update.summary.asOf).toBe('2024-09-03');
    expect(update.snapshot).toBe(true);
    expect(update.intraday).toHaveLength(2);
  });

  it('stops polling once the client disconnects', async () => {
    await firstUpdate();
    await new Promise((r) => setTimeout(r, 20));
    expect(live.activeSymbols).toBe(0);
  });

  it('answers unknown symbols with a JSON 404 instead of an empty stream', async () => {
    const res = await request(app).get('/api/stream/NOPE').expect(404);
    expect(res.body.error).toMatch(/No price data found/);
  });
});
