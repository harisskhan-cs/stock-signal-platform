import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarketSession } from '../src/contracts.js';
import type { PriceSeries } from '../src/data/priceService.js';
import type { IntradaySnapshot } from '../src/data/provider.js';
import { buildLiveUpdate, LiveHub, mergeTodayBar, type LiveEvent } from '../src/live/liveHub.js';
import type { Bar } from '../src/types.js';
import { makeBars, randomWalk } from './helpers.js';

const bars = makeBars(randomWalk(300, 21), '2023-01-02');
const lastDate = bars[bars.length - 1].date;
const series: PriceSeries = {
  symbol: 'TEST',
  name: 'Test Corp',
  currency: 'USD',
  exchange: 'TESTX',
  fetchedAt: '2024-01-01T00:00:00.000Z',
  source: 'cache',
  bars,
};

function snapshot(overrides: Partial<IntradaySnapshot> = {}): IntradaySnapshot {
  const close = bars[bars.length - 1].close;
  return {
    symbol: 'TEST',
    timeZone: 'America/New_York',
    session: 'regular',
    regularPrice: close * 1.02,
    regularTime: 1_700_000_000,
    previousClose: close,
    sessionBar: { date: '2099-01-02', open: close, high: close * 1.03, low: close * 0.99, close: close * 1.02, volume: 123 },
    extended: null,
    points: [{ time: 1_700_000_000, value: close * 1.02, session: 'regular' }],
    ...overrides,
  };
}

describe('mergeTodayBar', () => {
  const today: Bar = { date: '2099-01-02', open: 1, high: 2, low: 0.5, close: 1.5, volume: 9 };

  it('appends a session newer than the cache', () => {
    const merged = mergeTodayBar(bars, snapshot({ sessionBar: today }));
    expect(merged).toHaveLength(bars.length + 1);
    expect(merged.at(-1)).toEqual(today);
  });

  it('replaces the cached bar for a session that is still trading', () => {
    const merged = mergeTodayBar(bars, snapshot({ sessionBar: { ...today, date: lastDate } }));
    expect(merged).toHaveLength(bars.length);
    expect(merged.at(-1)?.close).toBe(1.5);
  });

  it('keeps the cached official bar once the market has closed', () => {
    const merged = mergeTodayBar(bars, snapshot({ session: 'closed', sessionBar: { ...today, date: lastDate } }));
    expect(merged).toBe(bars);
  });

  it('leaves history alone before the session opens', () => {
    expect(mergeTodayBar(bars, snapshot({ session: 'pre', sessionBar: null }))).toBe(bars);
  });
});

describe('buildLiveUpdate', () => {
  it('recomputes indicators and signals with the live candle included', () => {
    const update = buildLiveUpdate(series, snapshot(), new Date('2099-01-02T15:00:00Z'));
    expect(update.todayBar?.date).toBe('2099-01-02');
    expect(update.latest.date).toBe('2099-01-02');
    expect(update.summary.asOf).toBe('2099-01-02');
    expect(update.summary.close).toBeCloseTo(update.todayBar?.close as number, 10);
    expect(update.latest.sma200).not.toBeNull();
    expect(update.snapshot).toBe(true);
  });

  it('computes the change against the previous close', () => {
    const { quote } = buildLiveUpdate(series, snapshot({ regularPrice: 110, previousClose: 100 }), new Date());
    expect(quote.change).toBeCloseTo(10, 10);
    expect(quote.changePct).toBeCloseTo(0.1, 10);
    expect(quote.session).toBe('regular');
  });

  it('measures extended-hours moves from the regular close', () => {
    const { quote, todayBar } = buildLiveUpdate(
      series,
      snapshot({ session: 'pre', sessionBar: null, regularPrice: 100, extended: { session: 'pre', price: 97, time: 1_700_000_100 } }),
      new Date(),
    );
    expect(todayBar).toBeNull();
    expect(quote.extended).toMatchObject({ session: 'pre', price: 97, change: -3 });
    expect(quote.extended?.changePct).toBeCloseTo(-0.03, 10);
    expect(quote.lastTradeTime).toBe(new Date(1_700_000_100 * 1000).toISOString());
  });
});

describe('LiveHub', () => {
  let calls: number;
  let session: MarketSession;
  let fail: boolean;
  const prices = { get: async () => series };
  const provider = {
    fetchIntraday: async () => {
      calls += 1;
      if (fail) throw new Error('upstream down');
      return snapshot({ session });
    },
  };

  beforeEach(() => {
    vi.useFakeTimers();
    calls = 0;
    session = 'regular';
    fail = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const collect = () => {
    const events: LiveEvent[] = [];
    return { events, listener: (e: LiveEvent) => events.push(e) };
  };

  it('polls once per symbol however many clients are watching', async () => {
    const hub = new LiveHub(prices, provider, { intervals: { regular: 5_000 } });
    const a = collect();
    const b = collect();
    const stopA = hub.subscribe('TEST', a.listener);
    await vi.advanceTimersByTimeAsync(0);
    hub.subscribe('TEST', b.listener);

    expect(calls).toBe(1);
    expect(a.events).toHaveLength(1);
    expect(b.events).toHaveLength(1); // late joiner gets the latest state immediately

    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toBe(2);
    expect(a.events).toHaveLength(2);
    expect(b.events).toHaveLength(2);
    stopA();
  });

  it('stops polling when the last client leaves', async () => {
    const hub = new LiveHub(prices, provider);
    const stop = hub.subscribe('TEST', collect().listener);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls).toBe(1);
    expect(hub.activeSymbols).toBe(0);
  });

  it('polls slower while the market is closed', async () => {
    session = 'closed';
    const hub = new LiveHub(prices, provider, { intervals: { regular: 5_000, closed: 60_000 } });
    const stop = hub.subscribe('TEST', collect().listener);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls).toBe(2);
    stop();
  });

  it('reports failures to clients and retries later', async () => {
    fail = true;
    const hub = new LiveHub(prices, provider, { retryMs: 10_000 });
    const c = collect();
    const stop = hub.subscribe('TEST', c.listener);
    await vi.advanceTimersByTimeAsync(0);
    expect(c.events[0]).toEqual({ type: 'error', message: 'upstream down' });

    fail = false;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(c.events[1]?.type).toBe('update');
    stop();
  });
});
