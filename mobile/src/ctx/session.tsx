import type { Session } from '@supabase/supabase-js';
import { createContext, use, useEffect, useMemo, useState, type PropsWithChildren } from 'react';

import { isDemoMode } from '@/lib/config';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

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

  useEffect(() => {
    if (isDemoMode || !isSupabaseConfigured) return;

    let active = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active) setUser(toSessionUser(data.session));
      })
      .catch(() => {
        // An unreadable stored session is treated as signed out.
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      if (active) setUser(toSessionUser(next));
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      user,
      isLoading,
      signOut: async () => {
        if (isDemoMode) {
          setUser(null);
          return;
        }
        await supabase.auth.signOut();
      },
      enterDemo: () => {
        if (isDemoMode) setUser(DEMO_USER);
      },
    }),
    [user, isLoading]
  );

  return <SessionContext value={value}>{children}</SessionContext>;
}
