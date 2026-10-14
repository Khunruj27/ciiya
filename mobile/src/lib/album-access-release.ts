import { isDemoMode } from '@/lib/config';

/**
 * Access editing is prepared locally, not approved or deployed to Production.
 * Keep both live reads and writes closed until the matching owner API release
 * has separate approval and verification. No environment/cache value enables it.
 */
export const albumAccessReleaseEnabled = false;

/** Demo access changes are in-memory only and grant no real gallery access. */
export function isAlbumAccessEditingAvailable(): boolean {
  return isDemoMode || albumAccessReleaseEnabled;
}
