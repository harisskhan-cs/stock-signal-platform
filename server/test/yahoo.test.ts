import { describe, expect, it } from 'vitest';
import { adjust } from '../src/data/priceService.js';
import { SymbolNotFoundError } from '../src/data/provider.js';
import { parseChart, YahooProvider, type YahooChartResult } from '../src/data/yahoo.js';

const fixture: YahooChartResult = {
  meta: { symbol: 'shop.to', longName: 'Shopify Inc.', currency: 'CAD', fullExchangeName: 'Toronto', exchangeTimezoneName: 'America/Toronto' },
  // 2024-03-01, 2024-03-04 (with a missing close), 2024-03-05, 2024-03-05 again (in-progress duplicate); all 9:30 ET
  timestamp: [1709303400, 1709562600, 1709649000, 1709652600],
  events: { dividends: {} },
  indicators: {
    quote: [
      {
        open: [100, 101, 102, 102],
        high: [105, 106, 107, 108],
        low: [99, 100, 101, 101],
        close: [104, null, 106, 107],
        volume: [1000, 1100, 1200, 1300],
      },
    ],
    adjclose: [{ adjclose: [52, null, 53, 53.5] }],
  },
};

describe('parseChart', () => {
  const parsed = parseChart(fixture);

  it('converts timestamps to exchange-local dates and drops incomplete rows', () => {
    expect(parsed.bars.map((b) => b.date)).toEqual(['2024-03-01', '2024-03-05']);
  });

  it('keeps the last row when a date repeats', () => {
    expect(parsed.bars[1]).toMatchObject({ close: 107, adjClose: 53.5, volume: 1300 });
  });

  it('reads metadata and corporate actions', () => {
    expect(parsed.meta).toEqual({ symbol: 'SHOP.TO', name: 'Shopify Inc.', currency: 'CAD', exchange: 'Toronto' });
    expect(parsed.corporateActions).toBe(false);
    expect(parseChart({ ...fixture, events: { splits: { '1': {} } } }).corporateActions).toBe(true);
  });

  it('handles an empty window (e.g. a weekend refresh)', () => {
    expect(parseChart({ ...fixture, timestamp: undefined }).bars).toEqual([]);
  });
});

describe('adjust', () => {
  it('scales OHLC by adjClose / close', () => {
    const bar = adjust({ date: '2024-03-01', open: 100, high: 110, low: 90, close: 100, adjClose: 50, volume: 10 });
    expect(bar).toEqual({ date: '2024-03-01', open: 50, high: 55, low: 45, close: 50, volume: 10 });
  });
});

describe('YahooProvider', () => {
  const respond = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

  it('maps a 404 to SymbolNotFoundError', async () => {
    const provider = new YahooProvider(respond(404, { chart: { result: null, error: { code: 'Not Found', description: 'x' } } }));
    await expect(provider.fetchDaily('NOPE', new Date(0), new Date())).rejects.toBeInstanceOf(SymbolNotFoundError);
  });

  it('requests daily bars with adjusted closes and events', async () => {
    let url = '';
    const provider = new YahooProvider(async (input) => {
      url = String(input);
      return new Response(JSON.stringify({ chart: { result: [fixture], error: null } }));
    });
    const out = await provider.fetchDaily('SHOP.TO', new Date('2024-01-01T00:00:00Z'), new Date('2024-04-01T00:00:00Z'));
    expect(url).toContain('/v8/finance/chart/SHOP.TO?');
    expect(url).toContain('interval=1d');
    expect(url).toContain('includeAdjustedClose=true');
    expect(url).toContain('period1=1704067200');
    expect(out.bars).toHaveLength(2);
  });
});
