import express, { type ErrorRequestHandler, type Request, type RequestHandler } from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { analyze, backtest, InsufficientDataError } from './analysis.js';
import { getStrategy, STRATEGIES } from './backtest/strategies.js';
import { InvalidSymbolError, type PriceService } from './data/priceService.js';
import { ProviderError, SymbolNotFoundError, type PriceProvider } from './data/provider.js';
import type { PriceRepository } from './db/priceRepository.js';
import type { LiveHub } from './live/liveHub.js';

export interface AppDeps {
  prices: PriceService;
  provider: PriceProvider;
  repo: PriceRepository;
  live: LiveHub;
  /** Built React app to serve in production; omitted in development (Vite serves it). */
  staticDir?: string;
  log?: boolean;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a YYYY-MM-DD date');

const rangeQuery = z.object({ from: isoDate.optional(), to: isoDate.optional() });

const backtestQuery = rangeQuery.extend({
  strategy: z.string().default('composite'),
  costBps: z.coerce.number().min(0).max(500).default(5),
});

const searchQuery = z.object({ q: z.string().trim().min(1).max(50) });

export function createApp({ prices, provider, repo, live, staticDir, log = true }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  if (log) app.use(requestLogger);

  const api = express.Router();

  api.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  /** Symbols already in the PostgreSQL cache, most recently fetched first. */
  api.get('/symbols', async (_req, res) => {
    const symbols = await repo.listSymbols();
    res.json(symbols.map((s) => ({ ...s, lastFetchedAt: s.lastFetchedAt.toISOString() })));
  });

  /** Cached symbols with their latest close and daily change, for the watchlist panel. */
  api.get('/watchlist', async (_req, res) => {
    res.json(await repo.watchlist());
  });

  api.get('/search', async (req, res) => {
    const { q } = searchQuery.parse(req.query);
    res.json(await provider.search(q));
  });

  api.get('/strategies', (_req, res) => {
    res.json(STRATEGIES.map(({ id, name, description }) => ({ id, name, description })));
  });

  api.get('/prices/:symbol', async (req, res) => {
    const { from, to } = rangeQuery.parse(req.query);
    const { bars, ...series } = await prices.get(symbolParam(req));
    res.json({ ...series, bars: bars.filter((b) => (!from || b.date >= from) && (!to || b.date <= to)) });
  });

  /** Chart data, indicators, support/resistance and the plain-English signal summary. */
  api.get('/analysis/:symbol', async (req, res) => {
    const { from } = rangeQuery.parse(req.query);
    const { bars, ...series } = await prices.get(symbolParam(req));
    res.json({ ...series, ...analyze(bars, from) });
  });

  /** Strategy vs. buy-and-hold over the same window, plus the per-signal event study. */
  api.get('/backtest/:symbol', async (req, res) => {
    const query = backtestQuery.parse(req.query);
    const strategy = getStrategy(query.strategy);
    if (!strategy) throw new HttpError(400, `Unknown strategy "${query.strategy}". Options: ${STRATEGIES.map((s) => s.id).join(', ')}`);
    const { bars, ...series } = await prices.get(symbolParam(req));
    res.json({ ...series, ...backtest(bars, strategy, query) });
  });

  /**
   * Live quotes as Server-Sent Events. The first message carries the full
   * intraday series; later ones only the newest points, which the client
   * merges in. The browser's EventSource reconnects on its own if the
   * connection drops.
   */
  api.get('/stream/:symbol', async (req, res) => {
    // Load (and validate) the symbol first, so an unknown ticker gets a normal JSON 404.
    const { symbol } = await prices.get(symbolParam(req));

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    let first = true;
    const unsubscribe = live.subscribe(symbol, (event) => {
      if (event.type === 'error') {
        // Named "problem" because "error" is reserved for connection errors in EventSource.
        res.write(`event: problem\ndata: ${JSON.stringify({ message: event.message })}\n\n`);
        return;
      }
      const update = first ? event.update : { ...event.update, snapshot: false, intraday: event.update.intraday.slice(-3) };
      first = false;
      res.write(`event: update\ndata: ${JSON.stringify(update)}\n\n`);
    });
    // Comment lines keep proxies from closing an idle connection.
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  api.use((req) => {
    throw new HttpError(404, `No API route for ${req.method} ${req.originalUrl}`);
  });

  app.use('/api', api);

  if (staticDir && existsSync(staticDir)) {
    app.use(express.static(staticDir));
    // Client-side routes fall back to the SPA shell.
    app.get('/{*path}', (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}

function symbolParam(req: Request): string {
  return String(req.params.symbol ?? '');
}

const requestLogger: RequestHandler = (req, res, next) => {
  const start = performance.now();
  res.on('finish', () => {
    if (!req.originalUrl.startsWith('/api')) return;
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${(performance.now() - start).toFixed(0)}ms`);
  });
  next();
};

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const [status, message] = classify(err);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: message });
};

function classify(err: unknown): [number, string] {
  if (err instanceof HttpError) return [err.status, err.message];
  if (err instanceof z.ZodError) return [400, err.issues.map((i) => `${i.path.join('.') || 'query'}: ${i.message}`).join('; ')];
  if (err instanceof InvalidSymbolError) return [400, err.message];
  if (err instanceof SymbolNotFoundError) return [404, err.message];
  if (err instanceof InsufficientDataError) return [422, err.message];
  if (err instanceof ProviderError) return [502, err.message];
  return [500, 'Internal server error'];
}
