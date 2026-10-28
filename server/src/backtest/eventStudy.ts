import { EVENT_DEFINITIONS, type SignalEvent } from '../signals/events.js';
import type { Bar, Direction } from '../types.js';

export interface HorizonStats {
  /** Trading days after the signal. */
  horizon: number;
  samples: number;
  /** Share of signals followed by a move in the predicted direction. */
  hitRate: number | null;
  avgReturn: number | null;
  /** The same statistics over every bar in the window: what you'd get by chance. */
  baselineHitRate: number | null;
  baselineAvgReturn: number | null;
  /**
   * How much better the signal did than the baseline, signed so that positive
   * always means "the signal helped": for bearish signals, a lower-than-usual
   * return is a positive edge.
   */
  edge: number | null;
}

export interface EventStats {
  id: string;
  name: string;
  direction: Direction;
  description: string;
  occurrences: number;
  horizons: HorizonStats[];
}

export const DEFAULT_HORIZONS = [5, 10, 20] as const;

/**
 * For each signal type, measures what price did over the next N trading days
 * after it fired, and compares that with the unconditional N-day move over
 * the same period. A signal is only useful if it beats that baseline.
 *
 * Events whose horizon runs past the end of the data are left out of that
 * horizon's sample rather than measured on a shorter window.
 */
export function eventStudy(
  bars: readonly Bar[],
  events: readonly SignalEvent[],
  fromIndex = 0,
  horizons: readonly number[] = DEFAULT_HORIZONS,
): EventStats[] {
  const closes = bars.map((b) => b.close);
  const forward = (i: number, h: number) => (i + h < closes.length ? closes[i + h] / closes[i] - 1 : null);

  const baseline = new Map<number, number[]>();
  for (const h of horizons) {
    const all: number[] = [];
    for (let i = fromIndex; i + h < closes.length; i++) all.push(forward(i, h) as number);
    baseline.set(h, all);
  }

  return EVENT_DEFINITIONS.map((def) => {
    const fired = events.filter((e) => e.id === def.id && e.index >= fromIndex);
    const isHit = (r: number) => (def.direction === 'bullish' ? r > 0 : r < 0);

    const stats = horizons.map((h): HorizonStats => {
      const rets = fired.map((e) => forward(e.index, h)).filter((r): r is number => r != null);
      const base = baseline.get(h) ?? [];
      const avgReturn = mean(rets);
      const baselineAvgReturn = mean(base);
      const sign = def.direction === 'bullish' ? 1 : -1;
      return {
        horizon: h,
        samples: rets.length,
        hitRate: rets.length ? rets.filter(isHit).length / rets.length : null,
        avgReturn,
        baselineHitRate: base.length ? base.filter(isHit).length / base.length : null,
        baselineAvgReturn,
        edge: avgReturn != null && baselineAvgReturn != null ? sign * (avgReturn - baselineAvgReturn) : null,
      };
    });

    return {
      id: def.id,
      name: def.name,
      direction: def.direction,
      description: def.description,
      occurrences: fired.length,
      horizons: stats,
    };
  });
}

function mean(xs: readonly number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
