import type { Series } from '../types.js';

export function assertPeriod(period: number, name: string): void {
  if (!Number.isInteger(period) || period < 1) {
    throw new RangeError(`${name} period must be a positive integer, got ${period}`);
  }
}

export function emptySeries(length: number): Series {
  return new Array<number | null>(length).fill(null);
}

/** True when series `a` moves from at-or-below `b` on bar i-1 to strictly above it on bar i. */
export function crossedAbove(a: Series, b: Series | number, i: number): boolean {
  if (i < 1) return false;
  const prevA = a[i - 1];
  const curA = a[i];
  const prevB = typeof b === 'number' ? b : b[i - 1];
  const curB = typeof b === 'number' ? b : b[i];
  if (prevA == null || curA == null || prevB == null || curB == null) return false;
  return prevA <= prevB && curA > curB;
}

/** True when series `a` moves from at-or-above `b` on bar i-1 to strictly below it on bar i. */
export function crossedBelow(a: Series, b: Series | number, i: number): boolean {
  if (i < 1) return false;
  const prevA = a[i - 1];
  const curA = a[i];
  const prevB = typeof b === 'number' ? b : b[i - 1];
  const curB = typeof b === 'number' ? b : b[i];
  if (prevA == null || curA == null || prevB == null || curB == null) return false;
  return prevA >= prevB && curA < curB;
}
