import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { ApiClient } from '../api/client';

export interface ApiData<T> {
  data: T | undefined;
  error: ApiError | undefined;
  loading: boolean;
  reload: () => void;
}

/** Loads data from the API, re-running whenever `deps` change. Ignores stale responses. */
export function useApiData<T>(load: (api: ApiClient) => Promise<T>, deps: unknown[]): ApiData<T> {
  const { api } = useAuth();
  const [data, setData] = useState<T>();
  const [error, setError] = useState<ApiError>();
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadRef
      .current(api)
      .then((result) => {
        if (!active) return;
        setData(result);
        setError(undefined);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof ApiError ? err : new ApiError(0, 'UNKNOWN_ERROR', String(err)));
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [api, version, ...deps]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, loading, reload };
}

/** Wraps a mutation with pending/error state. */
export function useAction<A extends unknown[], R>(action: (...args: A) => Promise<R>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError>();
  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      setPending(true);
      setError(undefined);
      try {
        return await action(...args);
      } catch (err) {
        setError(err instanceof ApiError ? err : new ApiError(0, 'UNKNOWN_ERROR', String(err)));
        return undefined;
      } finally {
        setPending(false);
      }
    },
    [action],
  );
  return { run, pending, error, clearError: () => setError(undefined) };
}
