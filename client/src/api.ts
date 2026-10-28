import type {
  AnalysisResponse,
  BacktestResponse,
  CachedSymbolInfo,
  ErrorResponse,
  StrategyInfo,
  SymbolMatch,
  WatchlistEntry,
} from '../../server/src/contracts';

export type * from '../../server/src/contracts';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function get<T>(path: string, params: Record<string, string | number | undefined> = {}, signal?: AbortSignal): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, String(value));
  const qs = query.toString();
  const res = await fetch(`/api${path}${qs ? `?${qs}` : ''}`, { signal });
  const body = (await res.json().catch(() => null)) as T | ErrorResponse | null;
  if (!res.ok) {
    // No JSON body means the request never reached our API (e.g. the dev proxy couldn't connect).
    const message =
      body && typeof body === 'object' && 'error' in body ? body.error : `The API server isn't responding (HTTP ${res.status}). Is it running?`;
    throw new ApiError(res.status, message);
  }
  return body as T;
}

const sym = (symbol: string) => encodeURIComponent(symbol);

export const api = {
  analysis: (symbol: string, from: string, signal?: AbortSignal) => get<AnalysisResponse>(`/analysis/${sym(symbol)}`, { from }, signal),
  backtest: (symbol: string, params: { strategy: string; from?: string; costBps: number }, signal?: AbortSignal) =>
    get<BacktestResponse>(`/backtest/${sym(symbol)}`, params, signal),
  strategies: () => get<StrategyInfo[]>('/strategies'),
  symbols: () => get<CachedSymbolInfo[]>('/symbols'),
  watchlist: () => get<WatchlistEntry[]>('/watchlist'),
  search: (q: string, signal?: AbortSignal) => get<SymbolMatch[]>('/search', { q }, signal),
};
