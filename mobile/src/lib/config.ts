/** Origin of the Ciiya web app: API routes and public share links live here. */
export const SITE_URL = (process.env.EXPO_PUBLIC_SITE_URL || 'https://www.ciiya.app').replace(
  /\/+$/,
  ''
);

/**
 * Development-only fixture mode (`EXPO_PUBLIC_DEMO=1 npx expo start`): the app
 * runs on in-memory sample data with no network or account, so screens can be
 * checked in the simulator. `__DEV__` is false in release builds, so this can
 * never be switched on in a shipped app — and it grants no real access anyway.
 */
export const isDemoMode = __DEV__ && process.env.EXPO_PUBLIC_DEMO === '1';

export function shareUrl(shareToken: string) {
  return `${SITE_URL}/share/${shareToken}`;
}
