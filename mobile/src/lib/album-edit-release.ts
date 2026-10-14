import { isDemoMode } from '@/lib/config';

/**
 * The owner approved the bounded native metadata/cover release on 2026-10-14.
 * Its matching production backend is deployed and the denial smoke is verified.
 * Only metadata/cover are enabled; legacy sharing edits and deletion stay closed.
 * No environment toggle or cached album response may silently enable live writes.
 */
export const albumEditReleaseEnabled = true;

/** Demo still uses in-memory data; this gate enables only the approved live edits. */
export function isAlbumEditingAvailable(): boolean {
  return isDemoMode || albumEditReleaseEnabled;
}
