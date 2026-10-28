import { useEffect, useState } from 'react';

export interface FetchState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/**
 * Runs `load` whenever `deps` change, aborting the previous request so a slow
 * response for an old ticker can never overwrite the current one.
 */
export function useFetch<T>(load: ((signal: AbortSignal) => Promise<T>) | null, deps: unknown[]): FetchState<T> {
  const [state, setState] = useState<FetchState<T>>({ data: null, error: null, loading: load != null });

  useEffect(() => {
    if (!load) return;
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    load(controller.signal)
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((err: Error) => {
        if (controller.signal.aborted) return;
        setState({ data: null, error: err.message, loading: false });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
