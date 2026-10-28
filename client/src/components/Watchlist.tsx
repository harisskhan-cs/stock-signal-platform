import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, type LiveQuote, type WatchlistEntry } from '../api';
import { num, pct, tone } from '../format';

const SUGGESTIONS = ['AAPL', 'MSFT', 'NVDA', 'SPY', 'RY.TO', 'TD.TO', 'SHOP.TO', 'BMO', 'HSBA.L'];

interface Props {
  active: string;
  /** Live quote for the active symbol, so its row ticks with the stream. */
  live: LiveQuote | null;
  /** Bumped by the parent after each load, to re-read the cache. */
  refreshKey: string;
  onSelect: (symbol: string) => void;
}

/** Recently analyzed symbols (everything in the price cache), then suggestions. */
export function Watchlist({ active, live, refreshKey, onSelect }: Props) {
  const [rows, setRows] = useState<WatchlistEntry[]>([]);

  useEffect(() => {
    const load = () => api.watchlist().then(setRows).catch(() => {});
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [refreshKey]);

  const cached = new Set(rows.map((r) => r.symbol));
  const suggestions = SUGGESTIONS.filter((s) => !cached.has(s));

  return (
    <div className="pane-body">
      <table className="watch-table">
        <thead>
          <tr>
            <th>Ticker</th>
            <th>Last</th>
            <th>Chg</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isLive = live && row.symbol === active && live.symbol === row.symbol;
            const last = isLive ? (live.extended?.price ?? live.price) : row.last;
            const change = isLive ? (live.extended?.changePct ?? live.changePct) : row.changePct;
            return (
              <tr key={row.symbol} className={row.symbol === active ? 'on' : ''} onClick={() => onSelect(row.symbol)}>
                <td>
                  <span className="sym">{row.symbol}</span>
                  {row.name && <span className="watch-name">{row.name}</span>}
                </td>
                <FlashCell value={last}>{num(last)}</FlashCell>
                <td className={tone(change)}>{pct(change, 2, true)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {suggestions.length > 0 && (
        <>
          <div className="watch-section">Try</div>
          <table className="watch-table">
            <tbody>
              {suggestions.map((s) => (
                <tr key={s} onClick={() => onSelect(s)}>
                  <td>
                    <span className="sym">{s}</span>
                  </td>
                  <td className="dim">—</td>
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

/** A price cell that flashes green or red for a second when its value changes. */
function FlashCell({ value, children }: { value: number; children: ReactNode }) {
  const previous = useRef(value);
  const [flash, setFlash] = useState<{ cls: string; key: number }>({ cls: '', key: 0 });
  useEffect(() => {
    if (value !== previous.current) {
      const cls = value > previous.current ? 'cell-flash-up' : 'cell-flash-down';
      previous.current = value;
      // A new key remounts the cell so the animation replays even on consecutive moves the same way.
      setFlash((f) => ({ cls, key: f.key + 1 }));
    }
  }, [value]);
  return (
    <td key={flash.key} className={flash.cls}>
      {children}
    </td>
  );
}
