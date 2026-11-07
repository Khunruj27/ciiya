import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { secureStorage } from '@/lib/secure-storage';
import { installNativePkceCrypto } from '@/lib/pkce-crypto';
import { isDemoMode } from '@/lib/config';
import { createBoundedFetch } from '@/lib/bounded-fetch';

if (Platform.OS !== 'web') installNativePkceCrypto();

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * False when the public Supabase values are missing (see mobile/.env.example).
 * Screens check this to show a setup hint instead of crashing on launch.
 */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// Only the public anon key belongs in the app: every read and write runs as
// the signed-in photographer under row level security. Never ship the service
// role key or a worker secret in a mobile bundle.
export const supabase = createClient(
  supabaseUrl || 'https://unconfigured.invalid',
  supabaseAnonKey || 'unconfigured',
  {
    global: { fetch: createBoundedFetch() },
    auth: {
      storage: Platform.OS === 'web' ? undefined : secureStorage,
      // Demo must not restore/refresh a real session left by an earlier run.
      autoRefreshToken: !isDemoMode,
      persistSession: !isDemoMode,
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
  }
);

// Refresh tokens only while the app is in the foreground.
if (Platform.OS !== 'web' && !isDemoMode) {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
