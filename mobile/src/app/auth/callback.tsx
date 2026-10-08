import { Redirect } from 'expo-router';

/**
 * Landing route for the OAuth redirect (`ciiya://auth/callback`). The sign-in
 * sheet normally hands the URL straight back to `signInWithGoogle`, but if the
 * system delivers it as a deep link instead, send the photographer on to the
 * app rather than an "unmatched route" screen.
 */
export default function AuthCallbackScreen() {
  return <Redirect href="/" />;
}
