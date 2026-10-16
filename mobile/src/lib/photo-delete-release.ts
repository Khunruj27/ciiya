import { isDemoMode } from '@/lib/config';

/**
 * The owner approved the photo delete route release on 2026-10-16. Production
 * deployment dpl_37iBXvuGEuLqYuM79ftHzpUmdSFo serves it and its denial smoke is
 * verified. No environment/cache value toggles this gate.
 */
export const photoDeleteReleaseEnabled = true;

/** Demo deletions change in-memory fixtures only. */
export function isPhotoDeleteAvailable(): boolean {
  return isDemoMode || photoDeleteReleaseEnabled;
}
