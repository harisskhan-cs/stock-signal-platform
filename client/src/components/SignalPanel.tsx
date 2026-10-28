import type { PriceLevel, SignalSummary, Stance } from '../api';
import { money, pct, shortDate, stanceClass } from '../format';

const STANCE_TEXT: Record<Stance, string> = { 1: '▲ bullish', 0: '— neutral', [-1]: '▼ bearish' };

/** One-line definitions, shown when hovering an indicator name. */
const HINTS: Record<string, string> = {
  trend: 'Compares the price with its 200-day average, the most common long-term trend line.',
  ma_regime: 'Whether the 50-day average is above the 200-day average (golden cross) or below it (death cross).',
  macd: 'MACD measures momentum: the gap between a fast and a slow moving average, compared with its own 9-day average.',
  rsi: 'RSI runs from 0 to 100. Above 70 means the stock rose unusually fast; below 30, it fell unusually fast.',
  bollinger: 'Bands two standard deviations around the 20-day average. A close outside them is an unusually large move.',
};

interface Props {
  summary: SignalSummary;
  levels: PriceLevel[];
  currency: string | null;
  live: boolean;
}

export function SignalPanel({ summary, levels, currency, live }: Props) {
  const { score, verdict } = summary;
  const verdictTone = score == null ? 'flat' : score >= 0.2 ? 'up' : score <= -0.2 ? 'down' : 'flat';

  return (
    <>
      <div className="pane-head">
        <span className="pane-title">SIGNALS</span>
        <span className="dim num" title={live ? "Recomputed with today's live price on every update" : undefined}>
          {live && <span className="up">● LIVE </span>}
          {summary.asOf}
        </span>
      </div>
      <div className="pane-body">
        <div className="verdict">
          <div className="verdict-row">
            <span className={`verdict-label ${verdictTone}`}>{verdict ?? 'Not enough history'}</span>
            {score != null && <span className="verdict-score">{score > 0 ? '+' : ''}{score.toFixed(1)}</span>}
          </div>
          {summary.readings.length > 0 && (
            <div className="meter" role="img" aria-label={summary.readings.map((r) => `${r.name}: ${STANCE_TEXT[r.stance]}`).join(', ')}>
              {summary.readings.map((r) => (
                <span key={r.id} className={stanceClass(r.stance)} title={`${r.name}: ${STANCE_TEXT[r.stance]}`} />
              ))}
            </div>
          )}
          <p className="verdict-text">{summary.headline}</p>
        </div>

        <div className="section-label">
          <span>INDICATORS</span>
          <span className="dim">hover a name for what it means</span>
        </div>
        <ul className="rules">
          {summary.readings.map((r) => (
            <li key={r.id}>
              <div className="rule-row">
                <span className="rule-name">
                  <abbr title={HINTS[r.id]}>{r.name}</abbr>
                </span>
                <span className={`rule-stance ${r.stance > 0 ? 'up' : r.stance < 0 ? 'down' : 'flat'}`}>{STANCE_TEXT[r.stance]}</span>
              </div>
              <div className="rule-text">{r.explanation}</div>
            </li>
          ))}
        </ul>

        <div className="section-label">
          <span>SUPPORT / RESISTANCE</span>
          <span className="dim" title="Levels aren't part of the score: they're only confirmed days later, so they can't be backtested fairly.">
            context, not scored
          </span>
        </div>
        {levels.length > 0 && (
          <table className="levels">
            <tbody>
              {levels.map((l) => (
                <tr key={`${l.kind}-${l.price}`}>
                  <td className={l.kind === 'resistance' ? 'down' : 'up'}>{l.kind === 'resistance' ? 'R' : 'S'}</td>
                  <td>{money(l.price, currency)}</td>
                  <td className="dim">×{l.touches}</td>
                  <td className="dim">{pct(l.distancePct, 1, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <ul className="rules">
          {summary.context.map((c) => (
            <li key={c.id}>
              <div className="rule-text">
                <span className={c.stance > 0 ? 'up' : c.stance < 0 ? 'down' : 'dim'}>{c.stance > 0 ? '▲ ' : c.stance < 0 ? '▼ ' : ''}</span>
                {c.explanation}
              </div>
            </li>
          ))}
        </ul>

        {summary.recentEvents.length > 0 && (
          <>
            <div className="section-label">
              <span>SIGNALS FIRED · LAST 2 WEEKS</span>
            </div>
            <ul className="events-list">
              {[...summary.recentEvents].reverse().map((e) => (
                <li key={`${e.id}-${e.date}`}>
                  <span className="num">{shortDate(e.date)}</span>
                  <span className={e.direction === 'bullish' ? 'up' : 'down'}>{e.direction === 'bullish' ? '▲' : '▼'}</span>
                  <span>{e.name}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  );
}
