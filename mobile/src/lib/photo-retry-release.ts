import { isDemoMode } from '@/lib/config';

/**
 * Owner-requested reprocessing of failed photos is prepared locally. Its server
 * route is not in Production yet, so live requests stay closed until that
 * release is approved and verified. No environment/cache value enables it.
 */
export const photoRetryReleaseEnabled = false;

/** Demo retries change in-memory fixtures only. */
export function isPhotoRetryAvailable(): boolean {
  return isDemoMode || photoRetryReleaseEnabled;
}
