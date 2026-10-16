import { isDemoMode } from '@/lib/config';

/**
 * Deleting photos from the phone is prepared locally. Its server route is not
 * in Production yet, so live requests stay closed until that release is
 * approved and verified. No environment/cache value enables it.
 */
export const photoDeleteReleaseEnabled = false;

/** Demo deletions change in-memory fixtures only. */
export function isPhotoDeleteAvailable(): boolean {
  return isDemoMode || photoDeleteReleaseEnabled;
}
