import { useEffect, useRef, useState } from 'react';
import type { AnalysisResponse, LiveQuote, LiveUpdate, MarketSession } from '../api';
import { money, pct, signed, tone } from '../format';
import { IntradayChart } from './IntradayChart';

const SESSION_LABEL: Record<MarketSession, string> = {
  regular: 'MARKET OPEN',
  pre: 'PRE-MARKET',
  post: 'AFTER HOURS',
  closed: 'MARKET CLOSED',
};

interface Props {
  data: AnalysisResponse;
  live: LiveUpdate | null;
}

/** The security header: identity on the left, labelled price fields, today's intraday line. */
export function QuoteHeader({ data, live }: Props) {
  const bars = data.bars;
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const quote = live?.quote ?? null;

  // Until the live stream answers, show the last cached daily close.
  const price = quote?.price ?? last.close;
  const change = quote ? quote.change : prev ? last.close - prev.close : null;
  const changePct = quote ? quote.changePct : prev ? last.close / prev.close - 1 : null;
  const flash = useFlash(quote?.extended?.price ?? price);
  const exchange = [data.exchange, data.currency].filter(Boolean).join(' · ');

  return (
    <div className="quote">
      <div className="quote-id">
        <div className="quote-sym">
          {data.symbol}
          <small>{exchange}</small>
        </div>
        <div className="quote-name">{data.name ?? data.symbol}</div>
      </div>

      <div className="fields">
        <div className="field">
          <span className="field-label">{quote?.session === 'regular' ? 'LAST' : 'CLOSE'}</span>
          <span className={`field-value big ${quote?.extended ? '' : flash}`}>{money(price, data.currency)}</span>
        </div>
        <div className="field">
          <span className="field-label">CHG</span>
          <span className={`field-value ${tone(change)}`}>
            {change != null && change > 0 ? '▲' : change != null && change < 0 ? '▼' : ''} {signed(change)} {pct(changePct, 2, true)}
          </span>
        </div>
        {quote?.extended && (
          <div className="field">
            <span className="field-label">{quote.extended.session === 'pre' ? 'PRE-MKT' : 'AFTER HRS'}</span>
            <span className={`field-value ${tone(quote.extended.change)} ${flash}`}>
              {money(quote.extended.price, data.currency)} {pct(quote.extended.changePct, 2, true)}
            </span>
          </div>
        )}
        <div className="field">
          <span className="field-label">SESSION</span>
          <SessionField quote={quote} />
        </div>
      </div>

      {live && live.intraday.length > 1 && (
        <div className="intraday" title="Today, minute by minute, against the previous close">
          <span className="field-label">TODAY</span>
          <IntradayChart
            points={live.intraday}
            base={live.quote.session === 'pre' ? live.quote.price : live.quote.previousClose}
            timeZone={live.quote.timeZone}
          />
        </div>
      )}
    </div>
  );
}

function SessionField({ quote }: { quote: LiveQuote | null }) {
  if (!quote) return <span className="session closed">CONNECTING…</span>;
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: quote.timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }).format(new Date(quote.lastTradeTime));
  return (
    <span className={`session ${quote.session}`} title="Time of the last trade shown. Some exchanges are delayed by up to 15 minutes.">
      {quote.session === 'regular' && <span className="blink">● </span>}
      {SESSION_LABEL[quote.session]} <span className="dim">· {time}</span>
    </span>
  );
}

/** Returns a class that briefly highlights a value green or red when it changes. */
function useFlash(value: number): string {
  const previous = useRef(value);
  const [flash, setFlash] = useState('');
  useEffect(() => {
    if (value === previous.current) return;
    setFlash(value > previous.current ? 'flash-up' : 'flash-down');
    previous.current = value;
    const timer = setTimeout(() => setFlash(''), 900);
    return () => clearTimeout(timer);
  }, [value]);
  return flash;
}
