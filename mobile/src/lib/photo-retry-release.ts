import { isDemoMode } from '@/lib/config';

/**
 * The owner approved the reprocessing route release on 2026-10-15. Production
 * deployment dpl_2GTcCGARzJMsEqt4nRY338ANeZCq serves it and its denial smoke is
 * verified. No environment/cache value toggles this gate.
 */
export const photoRetryReleaseEnabled = true;

/** Demo retries change in-memory fixtures only. */
export function isPhotoRetryAvailable(): boolean {
  return isDemoMode || photoRetryReleaseEnabled;
}
