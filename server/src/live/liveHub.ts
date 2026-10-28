import type { LiveIndicators, LiveQuote, LiveUpdate, MarketSession } from '../contracts.js';
import type { PriceSeries } from '../data/priceService.js';
import type { IntradaySnapshot, PriceProvider } from '../data/provider.js';
import { computeIndicators, findLevels } from '../indicators/index.js';
import { detectEvents } from '../signals/events.js';
import { summarize } from '../signals/summary.js';
import type { Bar } from '../types.js';

export type LiveEvent = { type: 'update'; update: LiveUpdate } | { type: 'error'; message: string };
export type LiveListener = (event: LiveEvent) => void;

export interface LiveHubOptions {
  /** Poll intervals in milliseconds, by market session. */
  intervals?: Partial<Record<MarketSession, number>>;
  /** Wait after a failed poll before trying again. */
  retryMs?: number;
  now?: () => Date;
}

const DEFAULT_INTERVALS: Record<MarketSession, number> = {
  regular: 5_000,
  pre: 15_000,
  post: 15_000,
  closed: 60_000,
};

interface Channel {
  listeners: Set<LiveListener>;
  last: LiveEvent | null;
  timer: ReturnType<typeof setTimeout> | null;
  stopped: boolean;
}

/**
 * Fans live prices out to every connected browser.
 *
 * Each symbol gets one poller no matter how many clients watch it, so 50 open
 * tabs on AAPL still make one upstream request per interval. Polling speeds up
 * while the market is open and slows down when it is closed, and it stops
 * entirely when the last client disconnects.
 */
export class LiveHub {
  private readonly channels = new Map<string, Channel>();
  private readonly intervals: Record<MarketSession, number>;
  private readonly retryMs: number;
  private readonly now: () => Date;

  constructor(
    private readonly prices: { get(symbol: string): Promise<PriceSeries> },
    private readonly provider: Pick<PriceProvider, 'fetchIntraday'>,
    options: LiveHubOptions = {},
  ) {
    this.intervals = { ...DEFAULT_INTERVALS, ...options.intervals };
    this.retryMs = options.retryMs ?? 30_000;
    this.now = options.now ?? (() => new Date());
  }

  /** Starts receiving updates for `symbol`; returns the function that stops them. */
  subscribe(symbol: string, listener: LiveListener): () => void {
    let channel = this.channels.get(symbol);
    if (!channel) {
      channel = { listeners: new Set(), last: null, timer: null, stopped: false };
      this.channels.set(symbol, channel);
      void this.poll(symbol, channel);
    } else if (channel.last) {
      // Late joiners get the latest state immediately instead of waiting for the next poll.
      listener(channel.last);
    }
    channel.listeners.add(listener);

    const ch = channel;
    return () => {
      ch.listeners.delete(listener);
      if (ch.listeners.size === 0) {
        ch.stopped = true;
        if (ch.timer) clearTimeout(ch.timer);
        this.channels.delete(symbol);
      }
    };
  }

  /** Number of symbols currently being polled (for tests and monitoring). */
  get activeSymbols(): number {
    return this.channels.size;
  }

  private async poll(symbol: string, channel: Channel): Promise<void> {
    let delay = this.retryMs;
    let event: LiveEvent;
    try {
      const [series, intraday] = await Promise.all([this.prices.get(symbol), this.provider.fetchIntraday(symbol)]);
      const update = buildLiveUpdate(series, intraday, this.now());
      event = { type: 'update', update };
      delay = this.intervals[update.quote.session];
    } catch (err) {
      event = { type: 'error', message: (err as Error).message };
    }
    if (channel.stopped) return;
    channel.last = event;
    for (const listener of channel.listeners) listener(event);
    channel.timer = setTimeout(() => void this.poll(symbol, channel), delay);
  }
}

/**
 * Combines cached daily history with today's intraday data.
 *
 * Today's candle replaces the cached one for the same date (or is appended if
 * the cache doesn't have today yet), and the indicators and signal summary are
 * recomputed on the result, so the verdict reflects the price right now.
 */
export function buildLiveUpdate(series: PriceSeries, intraday: IntradaySnapshot, now: Date): LiveUpdate {
  const bars = mergeTodayBar(series.bars, intraday);
  const ind = computeIndicators(bars);
  const summary = summarize(ind, findLevels(bars), detectEvents(ind));
  const i = bars.length - 1;
  const latest: LiveIndicators = {
    date: bars[i].date,
    sma50: ind.sma50[i],
    sma200: ind.sma200[i],
    ema20: ind.ema20[i],
    rsi14: ind.rsi14[i],
    macd: ind.macd.macd[i],
    signal: ind.macd.signal[i],
    histogram: ind.macd.histogram[i],
    bbUpper: ind.bollinger.upper[i],
    bbMiddle: ind.bollinger.middle[i],
    bbLower: ind.bollinger.lower[i],
  };

  return {
    symbol: series.symbol,
    quote: toQuote(series.symbol, intraday, now),
    todayBar: bars !== series.bars ? bars[i] : null,
    latest,
    summary,
    snapshot: true,
    intraday: intraday.points,
  };
}

/**
 * Returns `bars` with the live session candle merged in, or the same array if
 * there is nothing newer. A session the cache already has is only replaced
 * while it is still trading (or just closed), because otherwise the cached
 * official daily bar is the better record.
 */
export function mergeTodayBar(bars: readonly Bar[], intraday: IntradaySnapshot): Bar[] {
  const live = intraday.sessionBar;
  const last = bars[bars.length - 1];
  if (!live || !last || live.date < last.date) return bars as Bar[];
  if (live.date > last.date) return [...bars, live];
  if (intraday.session === 'regular' || intraday.session === 'post') return [...bars.slice(0, -1), live];
  return bars as Bar[];
}

function toQuote(symbol: string, intraday: IntradaySnapshot, now: Date): LiveQuote {
  const { regularPrice: price, previousClose } = intraday;
  const ext = intraday.extended;
  const lastTrade = Math.max(intraday.regularTime, ext?.time ?? 0);
  return {
    symbol,
    session: intraday.session,
    price,
    previousClose,
    change: price - previousClose,
    changePct: previousClose ? price / previousClose - 1 : 0,
    extended: ext
      ? {
          session: ext.session,
          price: ext.price,
          change: ext.price - price,
          changePct: price ? ext.price / price - 1 : 0,
          time: new Date(ext.time * 1000).toISOString(),
        }
      : null,
    lastTradeTime: new Date(lastTrade * 1000).toISOString(),
    timeZone: intraday.timeZone,
    fetchedAt: now.toISOString(),
  };
}
