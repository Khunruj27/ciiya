import { isDemoMode } from '@/lib/config';

/**
 * Off until the owner approves the reprocess route and the photo worker that
 * renders it. No environment/cache value toggles this gate.
 */
export const photoReprocessReleaseEnabled = false;

/** Demo reprocessing changes in-memory fixtures only. */
export function isPhotoReprocessAvailable(): boolean {
  return isDemoMode || photoReprocessReleaseEnabled;
}
