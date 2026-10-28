# Stock Signal Platform

A full-stack technical analysis platform. Type a ticker and it:

- computes **SMA, EMA, RSI, MACD and Bollinger Bands** from daily price history,
- finds **support and resistance** levels from clustered swing highs and lows,
- combines the indicators into an **explainable bullish/bearish verdict**, with a plain-English sentence for every rule,
- **backtests** each strategy against **buy-and-hold** over the same window with transaction costs, and runs an **event study** that measures how often each signal was actually followed by a move in its direction,
- **streams live prices** while the market is open (pre-market, regular hours and after hours), redrawing today's candle and recomputing every indicator and the verdict on each update.

Daily history comes from Yahoo Finance and is cached in **PostgreSQL**, so repeat requests are served from the database instead of the network. Live prices are pushed to the browser with **Server-Sent Events**.

**Stack:** TypeScript · React · Node.js / Express · PostgreSQL · Vitest

![Workstation](docs/dashboard.jpg)

The interface is laid out like a trading workstation: docked panes (watchlist, chart, signals, backtest tabs) that fill the screen, a command line for tickers, labelled quote fields, and a status bar with feed state and world clocks. Type is set in Iosevka (narrow monospace for numbers) and Iosevka Aile, self-hosted. Every up/down is shown with ▲/▼ as well as colour.

| Key | Action |
| --- | --- |
| `/` | Jump to the ticker command line (type a ticker or company name, then Enter) |
| `1`–`5` | Chart range: 6M, 1Y, 2Y, 5Y, 10Y |
| `?` | Help: shortcuts and a plain-English glossary of every indicator |
| `Esc` | Close help or leave the command line |

## Quick start

Requires Node.js 20.19+. No database install is needed: by default the server runs an embedded PostgreSQL ([PGlite](https://pglite.dev), Postgres compiled to WebAssembly).

```bash
npm install
npm run dev
```

Open http://localhost:5173. The API runs on http://localhost:4000 and Vite proxies `/api` to it.

To use a real PostgreSQL server instead, set `DATABASE_URL`:

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/signals npm run dev
```

Production build (one server serves both the API and the React app):

```bash
npm run build
npm start
```

## Architecture

```
React (Vite) ──/api──▶ Express REST API
                          │
                          ├─ GET /api/stream ◀── LiveHub (one poller per symbol) ──▶ Yahoo 1-minute data
                          │
                          ├─ PriceService (cache-aside) ──▶ Yahoo Finance
                          │        │
                          │        └─ PriceRepository ──▶ PostgreSQL (daily_prices, symbols)
                          │
                          └─ analysis.ts
                               ├─ indicators/   SMA, EMA, RSI, MACD, Bollinger, support/resistance
                               ├─ signals/      state rules → score → verdict; crossover events
                               └─ backtest/     strategies, engine, metrics, event study
```

```
server/src/
  indicators/   pure functions: number[] in, (number | null)[] out, aligned to the input
  signals/      rules.ts (state rules + composite score), events.ts (crossovers), summary.ts (verdict + text)
  backtest/     strategies.ts, engine.ts (no-lookahead simulation), metrics.ts, eventStudy.ts
  data/         provider interface, Yahoo client (daily + intraday), PriceService (cache-aside)
  live/         LiveHub: shared polling, today's candle merged into history, signals recomputed
  db/           Postgres/PGlite adapter, schema, repository
  analysis.ts   composes the above into API responses
  contracts.ts  response types, imported by the React client so the two can't drift apart
client/src/     React workstation: watchlist, quote strip, chart (lightweight-charts), signals, backtest tabs, status bar
```

## How the analysis works

### Indicators

| Indicator | Definition |
| --- | --- |
| SMA(n) | Mean of the last n closes (running sum, O(n) overall) |
| EMA(n) | Seeded with SMA(n), then `k·price + (1−k)·prev` with `k = 2/(n+1)` |
| RSI(14) | Wilder's smoothing of average gains and losses; `100 − 100/(1+RS)` |
| MACD(12, 26, 9) | EMA12 − EMA26; signal = EMA9 of MACD; histogram = MACD − signal |
| Bollinger(20, 2) | SMA20 ± 2 population standard deviations; also %B and bandwidth |
| Support/resistance | Swing points (highest/lowest within ±5 bars), clustered within 1.5%, nearest levels with 2+ touches |

All indicators run on **split- and dividend-adjusted** prices, so a 4-for-1 split doesn't look like a 75% crash.

### Signals and the verdict

Five **state rules** each return +1 (bullish), 0 (neutral) or −1 (bearish) for a given day:

| Rule | Bullish | Bearish |
| --- | --- | --- |
| Long-term trend | close > 200-day SMA | close < 200-day SMA |
| 50/200 regime | SMA50 > SMA200 | SMA50 < SMA200 |
| MACD momentum | MACD > signal | MACD < signal |
| RSI(14) | < 30 (oversold) | > 70 (overbought) |
| Bollinger | close below lower band | close above upper band |

The **score** is the average stance in [−1, 1], mapped to Strongly bearish / Bearish / Neutral / Bullish / Strongly bullish. Every rule also produces an explanation, for example: *"MACD (4.20) is above its signal line (4.10) and the gap is widening, so short-term momentum is up. The lines crossed 3 trading days ago."*

Support/resistance is shown as **context but not scored**: a swing point is only confirmed several bars after it happens, so scoring it historically would leak future data into the backtest. Everything in the score can be backtested honestly.

### Backtesting

- **No lookahead.** A position decided with day *t*'s close earns day *t+1*'s return. A test pins this down (`acts on a signal one bar later`).
- **Same window, same costs.** Each strategy and buy-and-hold run over the identical window, starting after the 200-day warm-up, with a configurable per-trade cost in basis points.
- **Metrics:** total return, CAGR, Sharpe (annualized, 0% risk-free), max drawdown, volatility, exposure, trades, win rate.
- **Strategies:** composite score, 200-day trend filter, 50/200 golden cross, MACD crossover, RSI mean reversion, Bollinger mean reversion.

The **event study** looks at every crossover event (golden/death cross, MACD crosses, RSI leaving oversold/overbought, Bollinger band breaks) and reports the 5/10/20-day hit rate and average move after it, next to the same statistics over *all* days in the window. A signal only has value if it beats that baseline, and most single signals barely do. That's the point: each signal is measured, not assumed.

### Price cache

`PriceService` is a cache-aside layer over the `daily_prices` table:

1. **Fresh cache** (younger than `CACHE_TTL_MINUTES`) is served straight from PostgreSQL.
2. **Stale cache:** only the last few days are downloaded and upserted. If the provider reports a split or dividend in that window, the full history is re-downloaded instead, because adjusted prices change retroactively.
3. **Provider down:** stale data is served with a warning rather than failing.
4. **Concurrent requests** for the same symbol share one in-flight download.

Bulk writes are batched multi-row `INSERT ... ON CONFLICT DO UPDATE` statements inside a transaction.

### Live data

`GET /api/stream/:symbol` is a Server-Sent Events stream. Behind it, `LiveHub`:

1. **Polls once per symbol, however many browsers are watching.** Fifty open tabs on AAPL make one upstream request per interval. Late joiners get the latest state immediately, and polling stops when the last client disconnects.
2. **Adapts to the market session** using the exchange's own trading windows: every 5 s in regular hours, 15 s pre-market and after hours, 60 s when closed. Exchanges without extended-hours trading (e.g. the TSX) show as closed outside regular hours, and a "regular" window with no trades after 30 minutes is treated as a holiday.
3. **Builds today's daily candle** from 1-minute bars (preferring Yahoo's own day high/low/volume, which include auctions), merges it into the cached history, and **recomputes every indicator and the signal summary**, so the verdict reflects the current price.
4. **Sends a full snapshot first, then only the newest points**, which the client merges in. The browser's `EventSource` reconnects on its own after network drops.

The dashboard shows the session (Live / Pre-market / After hours / Market closed) with the time of the last trade, the extended-hours price, a minute-by-minute chart of today coloured against the previous close, and today's candle and indicator values updating in place.

Yahoo's free data is real-time for some exchanges and delayed for others (London, for example, runs about 15 minutes behind); the last-trade time is always shown so the delay is visible.

## REST API

| Method & path | Description |
| --- | --- |
| `GET /api/analysis/:symbol?from=YYYY-MM-DD` | Bars, indicators, levels, events and signal summary. Indicators use full history, then the response is cut to `from`. |
| `GET /api/backtest/:symbol?strategy=composite&from=&to=&costBps=5` | Strategy vs. buy-and-hold metrics, equity curves, trades and event study |
| `GET /api/stream/:symbol` | Live updates (Server-Sent Events): quote, session, today's candle, latest indicators, recomputed signal summary, 1-minute points |
| `GET /api/prices/:symbol?from=&to=` | Adjusted daily bars |
| `GET /api/strategies` | Available strategies |
| `GET /api/search?q=royal bank` | Ticker lookup by company name |
| `GET /api/symbols` | Symbols in the cache, with date coverage |
| `GET /api/watchlist` | Cached symbols with their latest close and daily change |
| `GET /api/health` | Health check |

Errors are JSON `{ "error": "..." }` with 400 (bad input), 404 (unknown symbol), 422 (not enough history) or 502 (provider failure).

## Testing

```bash
npm test
```

80 tests across indicators, signals, the backtest engine, the Yahoo parsers, the live hub and the HTTP API. Highlights:

- RSI checked against a hand-computed Wilder example; Bollinger checked against a hand-computed population standard deviation.
- A **no-lookahead** test: every rule gives the same answer on day *t* whether or not later data exists.
- API tests run against a real PostgreSQL engine (in-memory PGlite) with a fake price provider, and cover the cache hit, incremental refresh, full re-download after a split, the stale-cache fallback and request de-duplication.
- Live data: session detection (pre-market, regular, after hours, holidays, exchanges without extended hours), today's candle merging, one shared poller per symbol, slower polling when closed, error retry, and the SSE endpoint end to end (including that polling stops when the client disconnects).

CI (GitHub Actions) runs the suite twice, on PGlite and on a PostgreSQL 16 service container (`TEST_DATABASE_URL`), then builds the app.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | unset | PostgreSQL connection string; when unset, embedded PGlite is used |
| `PGLITE_DIR` | `server/.data/pglite` | Where the embedded database lives |
| `PORT` | `4000` | API port in production (`npm start`) |
| `CACHE_TTL_MINUTES` | `60` | How long cached prices count as fresh |
| `HISTORY_YEARS` | `25` | How much history to download for a new symbol |
| `LIVE_POLL_SECONDS` | `5` | Live polling interval during regular hours (15 s / 60 s outside them) |

## Limitations

- Yahoo's chart endpoint is unofficial and can change; the provider sits behind an interface (`PriceProvider`) so another source can be dropped in.
- Strategies are long-only and trade at the close; there's no position sizing or shorting, and backtests use daily bars only (live intraday data is for display).
- Live prices come from polling Yahoo, not an exchange feed: they are not tick-by-tick, and some exchanges are delayed.
- Plain-English explanations always use `$`, even for prices in other currencies.
- Event-study windows overlap (a 20-day window starts every day), so hit rates are descriptive, not independent samples.

For education only. This is not investment advice.
