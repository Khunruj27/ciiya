import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from 'react';

import { AccountUsageQuery } from '@/lib/account-usage';
import { isDemoMode } from '@/lib/config';
import { data } from '@/lib/data';
import { supabase } from '@/lib/supabase';

export function useAccountUsage(accountId: string) {
  const query = useMemo(() => new AccountUsageQuery(accountId,
    owner => data.fetchStorageUsage(owner)), [accountId]);
  const snapshot = useSyncExternalStore(query.subscribe, query.getSnapshot, query.getSnapshot);
  useLayoutEffect(() => {
    query.mount();
    return query.dispose;
  }, [query]);
  useEffect(() => {
    if (isDemoMode) return;
    let active = true;
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      if (active) query.observeOwner(next?.user.id ?? '');
    });
    return () => {
      active = false;
      query.dispose();
      listener.subscription.unsubscribe();
    };
  }, [query]);
  useFocusEffect(useCallback(() => {
    query.setFocused(true);
    void query.refresh();
    return () => query.setFocused(false);
  }, [query]));
  useEffect(() => {
    // Also reload after an SDK identity lifetime transition while still focused.
    // Single-flight merges this with the initial focus load.
    if (snapshot.authorized) void query.refresh();
  }, [query, snapshot.authorized, snapshot.authEpoch]);
  return { ...snapshot, refresh: query.refresh };
}
