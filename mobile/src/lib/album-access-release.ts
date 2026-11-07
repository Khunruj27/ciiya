import { isDemoMode } from '@/lib/config';

/**
 * The owner approved the album access (password/download) API release on
 * 2026-10-15. Production deployment dpl_EaHBkKKQYWUGpZ5fHSHhCvbud3Mo serves it
 * and its denial smoke is verified. No environment/cache value toggles this gate.
 */
export const albumAccessReleaseEnabled = true;

/** Demo access changes are in-memory only and grant no real gallery access. */
export function isAlbumAccessEditingAvailable(): boolean {
  return isDemoMode || albumAccessReleaseEnabled;
}
