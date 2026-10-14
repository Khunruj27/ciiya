import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { createCallbackCompleter } from '@/lib/auth-callback';
import { supabase } from '@/lib/supabase';

WebBrowser.maybeCompleteAuthSession();

/**
 * Where Google sends the photographer back to. This URL must be on the
 * Supabase project's redirect allow list (Authentication → URL Configuration):
 * `ciiya://auth/callback` for installed builds, and the specific Expo Go URL while
 * developing. If it is missing, Supabase falls back to the website and the
 * sign-in sheet never returns to the app.
 */
export function getOAuthRedirectUrl() {
  return Linking.createURL('auth/callback');
}

const completeCallback = createCallbackCompleter(async (code) => {
  // Supabase verifies against the PKCE verifier kept in this device's keychain.
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) throw error;
});

/** Used both by the browser result and when a callback launches a closed app. */
export function completeOAuthCallback(url: string) {
  return completeCallback(url, getOAuthRedirectUrl());
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

  if (!(await completeOAuthCallback(result.url))) throw new Error('Unexpected authentication callback');

  return 'signed-in';
}
