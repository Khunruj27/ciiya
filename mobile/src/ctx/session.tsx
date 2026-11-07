import type { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { createContext, use, useEffect, useMemo, useState, type PropsWithChildren } from 'react';

import { isDemoMode } from '@/lib/config';
import { completeOAuthCallback } from '@/lib/auth';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { setUploadOwner } from '@/lib/uploads/queue';

export type SessionUser = {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
};

type SessionValue = {
  user: SessionUser | null;
  /** True until the stored session has been read from the keychain. */
  isLoading: boolean;
  authError: boolean;
  clearAuthError: () => void;
  reportAuthError: () => void;
  signOut: () => Promise<void>;
  /** Development demo mode only: enter the app on sample data. */
  enterDemo: () => void;
};

const DEMO_USER: SessionUser = {
  id: 'demo-user',
  email: 'photographer@example.com',
  name: 'Demo Photographer',
  avatarUrl: null,
};

const SessionContext = createContext<SessionValue | null>(null);

export function useSession() {
  const value = use(SessionContext);
  if (!value) throw new Error('useSession must be used inside <SessionProvider />');
  return value;
}

function toSessionUser(session: Session | null): SessionUser | null {
  if (!session) return null;

  const metadata = session.user.user_metadata ?? {};
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);

  return {
    id: session.user.id,
    email: session.user.email ?? null,
    name: text(metadata.full_name) ?? text(metadata.name),
    avatarUrl: text(metadata.avatar_url) ?? text(metadata.picture),
  };
}

export function SessionProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<SessionUser | null>(isDemoMode ? DEMO_USER : null);
  const [isLoading, setIsLoading] = useState(!isDemoMode && isSupabaseConfigured);
  const [authError, setAuthError] = useState(false);

  useEffect(() => {
    if (isDemoMode || !isSupabaseConfigured) return;

    let active = true;

    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      if (active) {
        setUser(toSessionUser(next));
        if (next) setAuthError(false);
        // Fence queued work immediately, without waiting for a React effect.
        setUploadOwner(next?.user.id ?? null);
      }
    });

    async function restoreSession() {
      const initialUrl = await Linking.getInitialURL();
      if (initialUrl) {
        try { await completeOAuthCallback(initialUrl); }
        catch { if (active) setAuthError(true); }
      }
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      if (active) setUser(toSessionUser(data.session));
    }

    restoreSession()
      .catch(() => {
        if (active) setAuthError(true);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  // The upload queue belongs to whoever is signed in, and pauses when nobody is.
  const userId = user?.id ?? null;
  useEffect(() => {
    if (!isLoading) setUploadOwner(userId);
  }, [userId, isLoading]);

  const value = useMemo<SessionValue>(
    () => ({
      user,
      isLoading,
      authError,
      clearAuthError: () => setAuthError(false),
      reportAuthError: () => setAuthError(true),
      signOut: async () => {
        if (isDemoMode) {
          setUploadOwner(null);
          setUser(null);
          return;
        }
        setUploadOwner(null);
        try {
          // Sign out this device, not every other Ciiya session the user owns.
          const { error } = await supabase.auth.signOut({ scope: 'local' });
          if (error) throw error;
        } catch (error) {
          try {
            const { data, error: restoreError } = await supabase.auth.getSession();
            if (restoreError) throw restoreError;
            setUser(toSessionUser(data.session));
            setUploadOwner(data.session?.user.id ?? null);
          } catch {
            setUser(null);
            setUploadOwner(null);
          }
          throw error;
        }
      },
      enterDemo: () => {
        if (isDemoMode) setUser(DEMO_USER);
      },
    }),
    [user, isLoading, authError]
  );

  return <SessionContext value={value}>{children}</SessionContext>;
}
