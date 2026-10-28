import { useEffect, useState } from 'react';
import { api, type BacktestResponse, type BacktestRun, type EventStats, type StrategyInfo } from '../api';
import { monthsAgo, num, pct, shortDate, tone } from '../format';
import { useFetch } from '../useFetch';
import { EquityChart } from './EquityChart';

const PERIODS = [
  { label: '3Y', months: 36 },
  { label: '5Y', months: 60 },
  { label: '10Y', months: 120 },
  { label: 'MAX', months: null },
] as const;

const TABS = [
  { id: 'backtest', label: 'BACKTEST' },
  { id: 'events', label: 'EVENT STUDY' },
  { id: 'trades', label: 'TRADES' },
] as const;
type Tab = (typeof TABS)[number]['id'];

type Metrics = BacktestRun['metrics'];
interface Row {
  label: string;
  value: (m: Metrics) => number | null;
  format: (v: number | null) => string;
  /** Which direction counts as better, for highlighting. */
  better: 'higher' | 'lower' | null;
  hint: string;
}

const ROWS: Row[] = [
  { label: 'Total return', value: (m) => m.totalReturn, format: (v) => pct(v, 0), better: 'higher', hint: 'Growth over the whole window, after costs.' },
  { label: 'Per year (CAGR)', value: (m) => m.cagr, format: (v) => pct(v, 1), better: 'higher', hint: 'Compound annual growth rate.' },
  { label: 'Sharpe ratio', value: (m) => m.sharpe, format: (v) => num(v, 2), better: 'higher', hint: 'Return per unit of volatility (annualized, 0% risk-free rate). Higher is better.' },
  { label: 'Worst drop', value: (m) => m.maxDrawdown, format: (v) => pct(v, 1), better: 'lower', hint: 'Maximum drawdown: the largest peak-to-trough fall.' },
  { label: 'Volatility', value: (m) => m.annualVolatility, format: (v) => pct(v, 1), better: 'lower', hint: 'Annualized standard deviation of daily returns.' },
  { label: 'Time invested', value: (m) => m.exposure, format: (v) => pct(v, 0), better: null, hint: 'Share of days holding the stock rather than cash.' },
  { label: 'Trades', value: (m) => m.trades, format: (v) => (v == null ? '—' : String(v)), better: null, hint: 'Round trips (an open position counts as one).' },
  { label: 'Win rate', value: (m) => m.winRate, format: (v) => pct(v, 0), better: null, hint: 'Share of closed trades that made money.' },
];

export function BacktestPanel({ symbol }: { symbol: string }) {
  const [tab, setTab] = useState<Tab>('backtest');
  const [strategies, setStrategies] = useState<StrategyInfo[]>([]);
  const [strategy, setStrategy] = useState('composite');
  const [period, setPeriod] = useState<(typeof PERIODS)[number]['label']>('10Y');
  const [costBps, setCostBps] = useState(5);
  const [log, setLog] = useState(true);

  useEffect(() => {
    api.strategies().then(setStrategies).catch(() => {});
  }, []);

  const months = PERIODS.find((p) => p.label === period)?.months ?? null;
  const { data, error, loading } = useFetch(
    (signal) => api.backtest(symbol, { strategy, costBps, from: months == null ? undefined : monthsAgo(months) }, signal),
    [symbol, strategy, months, costBps],
  );
  const selected = strategies.find((s) => s.id === strategy);

  return (
    <section className="pane lower" aria-label="Backtest">
      <div className="pane-head">
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="bt-controls">
          <select value={strategy} onChange={(e) => setStrategy(e.target.value)} aria-label="Strategy" title={selected?.description}>
            {strategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <span className="toolbar" role="group" aria-label="Backtest period">
            {PERIODS.map((p) => (
              <button key={p.label} type="button" className={`tb ${p.label === period ? 'on' : ''}`} onClick={() => setPeriod(p.label)}>
                {p.label}
              </button>
            ))}
          </span>
          <select value={costBps} onChange={(e) => setCostBps(Number(e.target.value))} aria-label="Cost per trade" title="Trading cost charged on every buy and sell">
            {[0, 5, 10, 25, 50].map((bps) => (
              <option key={bps} value={bps}>
                cost {bps}bp
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={`pane-body ${loading && data ? 'is-loading' : ''}`}>
        {error && <div className="msg error">{error}</div>}
        {!error && !data && loading && <div className="empty">Running backtest…</div>}
        {!error && data && tab === 'backtest' && (
          <div className="bt-grid">
            <div className="bt-left">
              <p className="bt-summary">{describe(data)}</p>
              <table className="metrics">
                <thead>
                  <tr>
                    <th />
                    <th className="strat">Strategy</th>
                    <th>Buy &amp; hold</th>
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((row) => {
                    const a = row.value(data.result.metrics);
                    const b = row.value(data.benchmark.metrics);
                    const win = row.better && a != null && b != null && a !== b ? (row.better === 'higher' ? a > b : a < b) : null;
                    return (
                      <tr key={row.label} title={row.hint}>
                        <th scope="row">{row.label}</th>
                        <td className={win == null ? '' : win ? 'better' : 'worse'}>
                          {row.format(a)}
                          {win == null ? '' : win ? ' ▲' : ' ▼'}
                        </td>
                        <td>{row.format(b)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="note">
                {selected?.description} Trades happen at the next day's close, so the test can't peek ahead.{' '}
                <label>
                  <input type="checkbox" checked={log} onChange={(e) => setLog(e.target.checked)} /> log scale
                </label>
              </p>
            </div>
            <EquityChart strategy={data.result.equity} benchmark={data.benchmark.equity} strategyName={data.strategy.name} log={log} />
          </div>
        )}
        {!error && data && tab === 'events' && <EventStudy stats={data.eventStudy} />}
        {!error && data && tab === 'trades' && <Trades run={data.result} />}
      </div>
    </section>
  );
}

function describe(d: BacktestResponse): string {
  const s = d.result.metrics;
  const b = d.benchmark.metrics;
  const years = ((Date.parse(d.to) - Date.parse(d.from)) / (365.25 * 864e5)).toFixed(1);
  const head = `${years} years: ${pct(s.cagr)} a year vs ${pct(b.cagr)} buying and holding, worst drop ${pct(s.maxDrawdown, 0)} vs ${pct(b.maxDrawdown, 0)}.`;
  const sharpeBetter = s.sharpe != null && b.sharpe != null && s.sharpe > b.sharpe;
  if (s.cagr >= b.cagr && sharpeBetter) return `${head} It beat buy-and-hold on return and on risk.`;
  if (s.cagr >= b.cagr) return `${head} More return, but a bumpier ride.`;
  if (sharpeBetter) return `${head} Less return, but a smoother ride.`;
  return `${head} Buy-and-hold won on both counts.`;
}

function EventStudy({ stats }: { stats: EventStats[] }) {
  const horizons = stats[0]?.horizons.map((h) => h.horizon) ?? [];
  const longest = horizons.length - 1;
  return (
    <>
      <p className="note">
        After each signal fired, how often did the price move the way it predicted? The number in brackets is the same rate on an average day: a signal is only useful if it
        beats it. Edge is the extra {horizons[longest]}-day return compared with any day (flipped for bearish signals, so positive always means it helped).
      </p>
      <table className="study">
        <thead>
          <tr>
            <th>Signal</th>
            <th>Fired</th>
            {horizons.map((h) => (
              <th key={h}>{h}d hit</th>
            ))}
            <th>{horizons[longest]}d avg</th>
            <th>{horizons[longest]}d edge</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s) => {
            const last = s.horizons[longest];
            return (
              <tr key={s.id} title={s.description}>
                <th scope="row">
                  <span className={s.direction === 'bullish' ? 'up' : 'down'}>{s.direction === 'bullish' ? '▲' : '▼'}</span> {s.name}
                </th>
                <td>{s.occurrences}</td>
                {s.horizons.map((h) => (
                  <td key={h.horizon}>
                    {pct(h.hitRate, 0)} <span className="dim">({pct(h.baselineHitRate, 0)})</span>
                  </td>
                ))}
                <td className={tone(last?.avgReturn)}>{pct(last?.avgReturn, 2, true)}</td>
                <td className={tone(last?.edge)}>{pct(last?.edge, 2, true)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function Trades({ run }: { run: BacktestRun }) {
  if (run.trades.length === 0) return <div className="empty">The strategy never entered a trade in this window.</div>;
  const recent = [...run.trades].reverse();
  return (
    <table className="trades">
      <thead>
        <tr>
          <th>Bought</th>
          <th>Price</th>
          <th>Sold</th>
          <th>Price</th>
          <th>Days</th>
          <th>Return</th>
        </tr>
      </thead>
      <tbody>
        {recent.map((t) => (
          <tr key={t.entryDate}>
            <td>{shortDate(t.entryDate)} {t.entryDate.slice(0, 4)}</td>
            <td>{num(t.entryPrice)}</td>
            <td>{t.open ? <span className="amber">still open</span> : `${shortDate(t.exitDate)} ${t.exitDate.slice(0, 4)}`}</td>
            <td>{num(t.exitPrice)}</td>
            <td>{t.bars}</td>
            <td className={tone(t.return)}>{pct(t.return, 1, true)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
