import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useSession } from '@/ctx/session';
import { isDemoMode } from '@/lib/config';
import { supabase } from '@/lib/supabase';

type CoverContext = {
  albumId: string;
  accountId: string;
  /** The latest SDK event is authoritative before a React rerender. */
  observedAccount: string;
  focused: boolean;
  authorized: boolean;
  mounted: boolean;
  generation: number;
};

/**
 * A local lifetime/account fence, independent of the edit-release gate.
 * No token/session lookup, transport, mutation or refresh occurs in this hook.
 * Capture once before a human-requested cover change, then recheck the returned
 * predicate before starting a write and after awaiting it. Leaving and returning
 * to the same account/album/focus never revives an earlier captured predicate.
 */
export function useAlbumCoverGuard(albumId: string, focused: boolean): {
  available: boolean;
  capture: () => (() => boolean) | null;
} {
  const { user } = useSession();
  const accountId = user?.id ?? '';
  const [observedAccount, setObservedAccount] = useState(accountId);
  const [epoch, setEpoch] = useState(0);
  const context = useRef<CoverContext>({
    albumId, accountId, observedAccount: accountId, focused,
    authorized: Boolean(accountId), mounted: false, generation: 0,
  });

  useLayoutEffect(() => {
    const activeContext = context.current;
    activeContext.mounted = true;
    setEpoch(activeContext.generation);
    return () => {
      activeContext.mounted = false;
      activeContext.authorized = false;
      activeContext.generation += 1;
    };
  }, []);

  useLayoutEffect(() => {
    const activeContext = context.current;
    const scopeChanged = activeContext.albumId !== albumId || activeContext.accountId !== accountId;
    if (scopeChanged || activeContext.focused !== focused) {
      activeContext.generation += 1;
      setEpoch(activeContext.generation);
    }
    activeContext.albumId = albumId;
    activeContext.accountId = accountId;
    activeContext.focused = focused;
    if (scopeChanged || isDemoMode) {
      activeContext.authorized = Boolean(accountId &&
        (isDemoMode || activeContext.observedAccount === accountId));
    }
  }, [accountId, albumId, focused]);

  useEffect(() => {
    if (isDemoMode || !accountId) return;
    const activeContext = context.current;
    let subscribed = true;
    // Restore only an already observed matching owner during StrictMode replay;
    // never overwrite a newer SDK event with a stale React-state snapshot.
    activeContext.authorized = activeContext.observedAccount === accountId;
    setEpoch(activeContext.generation);
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!subscribed || !activeContext.mounted || activeContext.accountId !== accountId) return;
      const nextOwner = next?.user.id ?? '';
      const authorized = Boolean(accountId && nextOwner === accountId);
      if (nextOwner !== activeContext.observedAccount || authorized !== activeContext.authorized) {
        activeContext.generation += 1;
        setEpoch(activeContext.generation);
      }
      activeContext.observedAccount = nextOwner;
      activeContext.authorized = authorized;
      setObservedAccount(nextOwner);
    });
    return () => {
      subscribed = false;
      activeContext.authorized = false;
      activeContext.generation += 1;
      if (activeContext.mounted) setEpoch(activeContext.generation);
      listener.subscription.unsubscribe();
    };
  }, [accountId]);

  useFocusEffect(useCallback(() => {
    const activeContext = context.current;
    if (!activeContext.focused) activeContext.generation += 1;
    activeContext.focused = true;
    if (activeContext.mounted) setEpoch(activeContext.generation);
    return () => {
      activeContext.focused = false;
      activeContext.generation += 1;
      if (activeContext.mounted) setEpoch(activeContext.generation);
    };
  }, []));

  const capture = useCallback((): (() => boolean) | null => {
    const activeContext = context.current;
    if (!activeContext.mounted || !activeContext.focused || !activeContext.authorized ||
      !activeContext.accountId || !activeContext.albumId.trim() ||
      activeContext.accountId !== accountId || activeContext.albumId !== albumId ||
      activeContext.generation !== epoch) return null;
    const generation = activeContext.generation;
    const capturedAccount = activeContext.accountId;
    const capturedAlbum = activeContext.albumId;
    return () => activeContext.mounted && activeContext.focused && activeContext.authorized &&
      activeContext.generation === generation && activeContext.accountId === capturedAccount &&
      activeContext.albumId === capturedAlbum;
  }, [accountId, albumId, epoch]);

  return {
    available: Boolean(albumId.trim() && accountId && focused &&
      (isDemoMode || observedAccount === accountId)),
    capture,
  };
}
