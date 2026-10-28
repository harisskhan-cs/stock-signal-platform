import { useEffect, useRef, useState } from 'react';
import { api, type CacheSource } from './api';
import { BacktestPanel } from './components/BacktestPanel';
import { HelpOverlay } from './components/HelpOverlay';
import { OVERLAYS, PriceChart, type Overlay } from './components/PriceChart';
import { QuoteHeader } from './components/QuoteHeader';
import { SignalPanel } from './components/SignalPanel';
import { StatusBar } from './components/StatusBar';
import { SymbolSearch } from './components/SymbolSearch';
import { Watchlist } from './components/Watchlist';
import { monthsAgo } from './format';
import { useFetch } from './useFetch';
import { useLiveStream } from './useLiveStream';

const RANGES = [
  { label: '6M', months: 6 },
  { label: '1Y', months: 12 },
  { label: '2Y', months: 24 },
  { label: '5Y', months: 60 },
  { label: '10Y', months: 120 },
] as const;
type Range = (typeof RANGES)[number]['label'];

const HISTORY_SOURCE: Record<CacheSource, string> = {
  cache: 'POSTGRES CACHE',
  refreshed: 'POSTGRES · REFRESHED',
  downloaded: 'DOWNLOADED → POSTGRES',
  'stale-cache': 'STALE CACHE',
};

function initialSymbol(): string {
  const fromUrl = new URLSearchParams(window.location.search).get('s');
  return fromUrl?.toUpperCase() || 'AAPL';
}

export function App() {
  const [symbol, setSymbol] = useState(initialSymbol);
  const [range, setRange] = useState<Range>('1Y');
  const [overlays, setOverlays] = useState<Set<Overlay>>(new Set(['sma50', 'sma200', 'levels', 'events']));
  const [help, setHelp] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const months = RANGES.find((r) => r.label === range)?.months ?? 12;
  const analysis = useFetch((signal) => api.analysis(symbol, monthsAgo(months), signal), [symbol, months]);
  const data = analysis.error ? null : analysis.data;
  // Stream live prices once the history has loaded (that also confirms the ticker exists).
  const stream = useLiveStream(data?.symbol ?? null);
  const live = stream.update && stream.update.symbol === data?.symbol ? stream.update : null;

  // Keep the ticker in the URL so a view can be bookmarked or shared.
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('s', symbol);
    window.history.replaceState(null, '', url);
    document.title = `${symbol} · Stock Signal Platform`;
  }, [symbol]);

  // Keyboard: "/" ticker, 1-5 chart range, "?" help, Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setHelp(false);
        return;
      }
      const target = e.target as HTMLElement;
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
      // Some keyboard layouts and tools report Shift+/ as "/" with shiftKey rather than "?".
      const question = e.key === '?' || (e.key === '/' && e.shiftKey);
      if (e.key === '/' && !question) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (question) {
        setHelp((h) => !h);
      } else if (e.key >= '1' && e.key <= '5') {
        setRange(RANGES[Number(e.key) - 1].label);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggle = (id: Overlay) =>
    setOverlays((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <div className="ws">
        <header className="cmd">
          <div className="brand" title="Stock Signal Platform">
            SSP
          </div>
          <SymbolSearch onSelect={setSymbol} inputRef={searchRef} />
          <button type="button" className="cmd-help" onClick={() => setHelp(true)}>
            <kbd>?</kbd> help · what the indicators mean
          </button>
        </header>

        <aside className="pane watch" aria-label="Watchlist">
          <div className="pane-head">
            <span className="pane-title">WATCHLIST</span>
            <span className="dim">recently viewed</span>
          </div>
          <Watchlist active={data?.symbol ?? symbol} live={live?.quote ?? null} refreshKey={`${data?.symbol}-${data?.fetchedAt}`} onSelect={setSymbol} />
        </aside>

        <main className={`center ${analysis.loading && data ? 'is-loading' : ''}`}>
          {analysis.error && (
            <div className="pane">
              <div className="msg error">
                {symbol}: {analysis.error}
              </div>
            </div>
          )}
          {!data && !analysis.error && <div className="pane empty">Loading {symbol}. The first load downloads up to 25 years of prices.</div>}
          {data && (
            <>
              <QuoteHeader data={data} live={live} />
              {data.warning && <div className="pane msg warning">{data.warning}</div>}
              <section className="pane chart-pane" aria-label="Price chart">
                <div className="pane-head">
                  <span className="pane-title">
                    <b>{data.symbol}</b> PRICE · RSI 14 · MACD 12/26/9
                  </span>
                  <div className="toolbar">
                    {RANGES.map((r, i) => (
                      <button key={r.label} type="button" className={`tb ${r.label === range ? 'on' : ''}`} onClick={() => setRange(r.label)} title={`Press ${i + 1}`}>
                        {r.label}
                      </button>
                    ))}
                    <span className="sep" />
                    {OVERLAYS.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        className={`tb tb-toggle ${overlays.has(o.id) ? 'on' : ''}`}
                        aria-pressed={overlays.has(o.id)}
                        onClick={() => toggle(o.id)}
                        title={o.hint}
                      >
                        <span className="swatch" style={{ background: overlays.has(o.id) ? o.color : 'transparent', color: o.color }} />
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
                <PriceChart data={data} overlays={overlays} live={live} />
              </section>
              <BacktestPanel symbol={data.symbol} />
            </>
          )}
        </main>

        <aside className="pane side" aria-label="Signals">
          {data ? (
            <SignalPanel summary={live?.summary ?? data.summary} levels={data.levels} currency={data.currency} live={live != null} />
          ) : (
            <div className="empty">Signals appear once a ticker loads.</div>
          )}
        </aside>

        <StatusBar status={stream.status} problem={stream.problem} quote={live?.quote ?? null} historySource={data ? HISTORY_SOURCE[data.source] : null} />

        <footer className="legal">
          Prices from Yahoo Finance, cached in PostgreSQL; some exchanges are delayed up to 15 minutes. Charts by{' '}
          <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
            TradingView Lightweight Charts
          </a>
          . For education only, not investment advice.
        </footer>
      </div>
      {help && <HelpOverlay onClose={() => setHelp(false)} />}
    </>
  );
}
