import { isDemoMode } from '@/lib/config';

/**
 * The owner approved the presets route release on 2026-10-16. Production
 * deployment dpl_CfxwZnUM2v8QtsQ6ntPYZGRWmFdi serves it and its denial smoke is
 * verified. No environment/cache value toggles this gate.
 */
export const presetReleaseEnabled = true;

/** Demo presets live in memory only. */
export function isPresetPickingAvailable(): boolean {
  return isDemoMode || presetReleaseEnabled;
}
