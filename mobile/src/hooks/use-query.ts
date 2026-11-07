import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

type QueryState<T> = {
  data: T | null;
  /** The last failure, cleared by the next successful load. */
  error: unknown;
  loading: boolean;
};

/**
 * Loads data when the screen gains focus — so a list is fresh again after the
 * photographer comes back from creating, editing or deleting something — and
 * supports pull-to-refresh. Earlier data stays visible while reloading.
 */
export function useQuery<T>(fetcher: () => Promise<T>) {
  const [state, setState] = useState<QueryState<T>>({ data: null, error: null, loading: true });
  const [refreshing, setRefreshing] = useState(false);
  const fetcherRef = useRef(fetcher);
  const latestRequest = useRef(0);

  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const load = useCallback(async () => {
    const request = ++latestRequest.current;

    try {
      const data = await fetcherRef.current();
      // Ignore a slow response that a newer request has already replaced.
      if (request === latestRequest.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (request === latestRequest.current) {
        setState((previous) => ({ data: previous.data, error, loading: false }));
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return { ...state, refreshing, refresh };
}
