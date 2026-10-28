import { useEffect, useState } from 'react';
import type { IntradayPoint, LiveUpdate } from './api';

export type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'unavailable';

export interface LiveState {
  update: LiveUpdate | null;
  status: LiveStatus;
  /** The server's last polling error, if the most recent poll failed. */
  problem: string | null;
}

/**
 * Subscribes to the server's live stream for `symbol` (Server-Sent Events).
 * EventSource reconnects by itself after network drops, and the server sends
 * a full snapshot first on every connection, so nothing is lost.
 */
export function useLiveStream(symbol: string | null): LiveState {
  const [state, setState] = useState<LiveState>({ update: null, status: 'connecting', problem: null });

  useEffect(() => {
    if (!symbol) return;
    setState({ update: null, status: 'connecting', problem: null });
    const source = new EventSource(`/api/stream/${encodeURIComponent(symbol)}`);

    source.addEventListener('update', (e) => {
      const msg = JSON.parse((e as MessageEvent<string>).data) as LiveUpdate;
      setState((prev) => {
        const merged = msg.snapshot || !prev.update ? msg : { ...msg, intraday: mergePoints(prev.update.intraday, msg.intraday) };
        return { update: merged, status: 'live', problem: null };
      });
    });
    source.addEventListener('problem', (e) => {
      const { message } = JSON.parse((e as MessageEvent<string>).data) as { message: string };
      setState((prev) => ({ ...prev, problem: message }));
    });
    source.onerror = () => {
      setState((prev) => ({ ...prev, status: source.readyState === EventSource.CLOSED ? 'unavailable' : 'reconnecting' }));
    };
    return () => source.close();
  }, [symbol]);

  return state;
}

/** Replaces any points at or after the first new timestamp, then appends the new ones. */
function mergePoints(prev: IntradayPoint[], next: IntradayPoint[]): IntradayPoint[] {
  if (next.length === 0) return prev;
  const cut = next[0].time;
  return [...prev.filter((p) => p.time < cut), ...next];
}
