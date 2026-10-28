import { describe, expect, it } from 'vitest';
import { parseIntraday, type YahooChartResult } from '../src/data/yahoo.js';

// Tuesday 2024-03-05, New York (EST, UTC-5). Midnight UTC = 1709596800.
const MIDNIGHT_UTC = 1709596800;
const et = (hours: number, minutes = 0) => MIDNIGHT_UTC + (hours + 5) * 3600 + minutes * 60;
const periods = {
  pre: { start: et(4), end: et(9, 30), gmtoffset: -18000 },
  regular: { start: et(9, 30), end: et(16), gmtoffset: -18000 },
  post: { start: et(16), end: et(20), gmtoffset: -18000 },
};

function chart(points: { ts: number; o: number; h: number; l: number; c: number; v: number }[], meta: Partial<YahooChartResult['meta']> = {}): YahooChartResult {
  return {
    meta: {
      symbol: 'aapl',
      exchangeTimezoneName: 'America/New_York',
      regularMarketPrice: 104.5,
      regularMarketTime: et(16),
      regularMarketDayHigh: 105.5,
      regularMarketDayLow: 98.5,
      regularMarketVolume: 5000,
      chartPreviousClose: 100,
      hasPrePostMarketData: true,
      currentTradingPeriod: periods,
      ...meta,
    },
    timestamp: points.map((p) => p.ts),
    indicators: {
      quote: [
        {
          open: points.map((p) => p.o),
          high: points.map((p) => p.h),
          low: points.map((p) => p.l),
          close: points.map((p) => p.c),
          volume: points.map((p) => p.v),
        },
      ],
    },
  };
}

const fullDay = chart([
  { ts: et(9), o: 101, h: 101, l: 101, c: 101, v: 10 }, // pre-market
  { ts: et(9, 30), o: 100, h: 102, l: 99, c: 101, v: 1000 },
  { ts: et(10), o: 101, h: 105, l: 100, c: 104, v: 2000 },
  { ts: et(16, 30), o: 103, h: 103, l: 103, c: 103, v: 50 }, // after hours
]);

describe('parseIntraday', () => {
  it('labels each point with its session', () => {
    const snap = parseIntraday(fullDay, et(10, 1));
    expect(snap.points.map((p) => p.session)).toEqual(['pre', 'regular', 'regular', 'post']);
    expect(snap.symbol).toBe('AAPL');
  });

  it('builds today\'s candle during the regular session, preferring Yahoo\'s day stats', () => {
    const snap = parseIntraday(fullDay, et(10, 1));
    expect(snap.session).toBe('regular');
    expect(snap.sessionBar).toEqual({ date: '2024-03-05', open: 100, high: 105.5, low: 98.5, close: 104.5, volume: 5000 });
    expect(snap.extended).toBeNull();
    expect(snap.previousClose).toBe(100);
  });

  it('reports the after-hours price during the post-market session', () => {
    const snap = parseIntraday(fullDay, et(17));
    expect(snap.session).toBe('post');
    expect(snap.extended).toEqual({ session: 'post', price: 103, time: et(16, 30) });
  });

  it('reports pre-market trading before the open, with no candle for today yet', () => {
    const preOnly = chart([{ ts: et(6), o: 99, h: 99, l: 99, c: 99, v: 5 }], { regularMarketTime: et(16) - 86_400 });
    const snap = parseIntraday(preOnly, et(6, 5));
    expect(snap.session).toBe('pre');
    expect(snap.sessionBar).toBeNull();
    expect(snap.extended?.price).toBe(99);
  });

  it('treats extended hours as closed on exchanges without extended trading', () => {
    const tsx = chart([{ ts: et(10), o: 1, h: 1, l: 1, c: 1, v: 1 }], { hasPrePostMarketData: false });
    expect(parseIntraday(tsx, et(8)).session).toBe('closed');
  });

  it('treats a "regular" window with no trades after 30 minutes as a holiday', () => {
    const holiday = chart([{ ts: et(9), o: 1, h: 1, l: 1, c: 1, v: 1 }]);
    expect(parseIntraday(holiday, et(9, 45)).session).toBe('regular');
    expect(parseIntraday(holiday, et(11)).session).toBe('closed');
  });

  it('is closed overnight', () => {
    expect(parseIntraday(fullDay, et(21)).session).toBe('closed');
  });
});
