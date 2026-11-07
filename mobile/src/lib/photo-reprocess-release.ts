import { isDemoMode } from '@/lib/config';

/**
 * The owner approved the reprocess release on 2026-10-16. The photo worker
 * (Railway deployment 67b9d01e) renders it and production deployment
 * dpl_8LrpUhkZToRnHVPrHahmEWLJaxng serves the route; its denial smoke is
 * verified. No environment/cache value toggles this gate.
 */
export const photoReprocessReleaseEnabled = true;

/** Demo reprocessing changes in-memory fixtures only. */
export function isPhotoReprocessAvailable(): boolean {
  return isDemoMode || photoReprocessReleaseEnabled;
}
