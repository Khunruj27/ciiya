import { isDemoMode } from '@/lib/config';

/**
 * Choosing and adding Lightroom presets for phone uploads is prepared locally.
 * Its server route is not in Production yet, so live requests stay closed until
 * that release is approved and verified. No environment/cache value enables it.
 */
export const presetReleaseEnabled = false;

/** Demo presets live in memory only. */
export function isPresetPickingAvailable(): boolean {
  return isDemoMode || presetReleaseEnabled;
}
