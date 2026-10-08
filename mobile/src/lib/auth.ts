import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { supabase } from '@/lib/supabase';

/**
 * Where Google sends the photographer back to. This URL must be on the
 * Supabase project's redirect allow list (Authentication → URL Configuration):
 * `ciiya://**` for installed builds, and the Expo Go `exp://` URL while
 * developing. If it is missing, Supabase falls back to the website and the
 * sign-in sheet never returns to the app.
 */
export function getOAuthRedirectUrl() {
  return Linking.createURL('auth/callback');
}

/** Reads the tokens Supabase appends to the redirect URL (fragment or query). */
function readSessionTokens(url: string) {
  const start = url.search(/[?#]/);
  if (start === -1) return null;

  const params = new URLSearchParams(url.slice(start + 1).replace(/[?#]/g, '&'));
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');

  if (!accessToken || !refreshToken) return null;
  return { access_token: accessToken, refresh_token: refreshToken };
}

/**
 * Google sign-in through the system authentication sheet, following the
 * Supabase native OAuth guide. Resolves to `cancelled` when the photographer
 * closes the sheet; throws when Google or Supabase reports a failure.
 */
export async function signInWithGoogle(): Promise<'signed-in' | 'cancelled'> {
  const redirectTo = getOAuthRedirectUrl();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  });

  if (error) throw error;
  if (!data.url) throw new Error('Missing OAuth URL');

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

  if (result.type !== 'success') return 'cancelled';

  const tokens = readSessionTokens(result.url);
  if (!tokens) throw new Error('OAuth redirect did not include a session');

  const { error: sessionError } = await supabase.auth.setSession(tokens);
  if (sessionError) throw sessionError;

  return 'signed-in';
}
