export const TRADING_DAYS_PER_YEAR = 252;

export interface PerformanceMetrics {
  totalReturn: number;
  /** Compound annual growth rate. */
  cagr: number;
  annualVolatility: number;
  /** Annualized, with a 0% risk-free rate. */
  sharpe: number | null;
  /** Largest peak-to-trough fall in equity, as a positive fraction. */
  maxDrawdown: number;
  /** Fraction of bars spent holding the stock. */
  exposure: number;
}

/**
 * @param equity  equity curve starting at 1
 * @param dates   YYYY-MM-DD for each equity point (used for CAGR's calendar years)
 * @param positions position held over each bar (same length as equity; index 0 unused)
 */
export function computeMetrics(equity: readonly number[], dates: readonly string[], positions: readonly number[]): PerformanceMetrics {
  const n = equity.length;
  const final = equity[n - 1];
  const totalReturn = final / equity[0] - 1;

  const years = n > 1 ? (Date.parse(dates[n - 1]) - Date.parse(dates[0])) / (365.25 * 24 * 3600 * 1000) : 0;
  const cagr = years > 0 && final > 0 ? (final / equity[0]) ** (1 / years) - 1 : 0;

  const returns: number[] = [];
  for (let i = 1; i < n; i++) returns.push(equity[i] / equity[i - 1] - 1);
  const mean = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance = returns.length > 1 ? returns.reduce((a, r) => a + (r - mean) ** 2, 0) / (returns.length - 1) : 0;
  const sd = Math.sqrt(variance);
  const annualVolatility = sd * Math.sqrt(TRADING_DAYS_PER_YEAR);
  const sharpe = sd > 0 ? (mean / sd) * Math.sqrt(TRADING_DAYS_PER_YEAR) : null;

  let peak = equity[0];
  let maxDrawdown = 0;
  for (const value of equity) {
    peak = Math.max(peak, value);
    maxDrawdown = Math.max(maxDrawdown, (peak - value) / peak);
  }

  const held = positions.slice(1);
  const exposure = held.length ? held.filter((p) => p !== 0).length / held.length : 0;

  return { totalReturn, cagr, annualVolatility, sharpe, maxDrawdown, exposure };
}
