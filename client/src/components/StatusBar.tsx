import { useEffect, useState } from 'react';
import type { LiveQuote } from '../api';
import type { LiveStatus } from '../useLiveStream';

const CLOCKS = [
  { label: 'NY', zone: 'America/New_York' },
  { label: 'TOR', zone: 'America/Toronto' },
  { label: 'LDN', zone: 'Europe/London' },
  { label: 'TYO', zone: 'Asia/Tokyo' },
];

interface Props {
  status: LiveStatus;
  problem: string | null;
  quote: LiveQuote | null;
  historySource: string | null;
}

/** Feed state, data source, world clocks and the main keyboard shortcuts. */
export function StatusBar({ status, problem, quote, historySource }: Props) {
  const now = useNow();
  const feed =
    status === 'live' && problem
      ? { cls: 'feed-warn', text: 'FEED · LAST POLL FAILED, RETRYING' }
      : status === 'live'
      ? { cls: 'feed-ok', text: `FEED OK · ${quote ? new Date(quote.fetchedAt).toLocaleTimeString('en-US', { hour12: false }) : ''}` }
      : status === 'reconnecting'
        ? { cls: 'feed-warn', text: 'FEED RECONNECTING' }
        : status === 'unavailable'
          ? { cls: 'feed-warn', text: 'FEED OFFLINE' }
          : { cls: '', text: 'FEED CONNECTING' };

  return (
    <footer className="status">
      <span className={feed.cls} title="Live prices are pushed from the server over Server-Sent Events">
        {feed.text}
      </span>
      <span title="Live and historical prices come from Yahoo Finance. Some exchanges are delayed by up to 15 minutes.">
        SRC <b>YAHOO</b>
      </span>
      {historySource && (
        <span title="Daily history is cached in PostgreSQL">
          HIST <b>{historySource}</b>
        </span>
      )}
      {CLOCKS.map((c) => (
        <span key={c.label}>
          {c.label} <b>{now.toLocaleTimeString('en-GB', { timeZone: c.zone, hour: '2-digit', minute: '2-digit' })}</b>
        </span>
      ))}
      <span className="right">NOT INVESTMENT ADVICE</span>
      <span>
        <kbd>/</kbd> ticker&nbsp;&nbsp;<kbd>1</kbd>–<kbd>5</kbd> range&nbsp;&nbsp;<kbd>?</kbd> help
      </span>
    </footer>
  );
}

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
