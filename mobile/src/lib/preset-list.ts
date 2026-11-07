import type { AlbumPreset } from '@/lib/data/types';

/** How many presets the upload sheet shows before "show all". */
export const COLLAPSED_PRESET_COUNT = 4;

function presetTime(preset: AlbumPreset) {
  const time = preset.createdAt ? Date.parse(preset.createdAt) : NaN;
  return Number.isFinite(time) ? time : -Infinity;
}

/**
 * One entry per preset name, newest first. Re-uploading the same Lightroom
 * preset leaves several stored copies with the same name; offering each copy
 * makes the list long and the copies impossible to tell apart. The copy the
 * photographer used last (`keepPath`) wins its name so a remembered choice
 * stays selected.
 */
export function uniquePresets(presets: AlbumPreset[], keepPath: string | null = null): AlbumPreset[] {
  const ordered = [...presets].sort((a, b) => presetTime(b) - presetTime(a));
  const byName = new Map<string, AlbumPreset>();

  for (const preset of ordered) {
    const name = preset.name.trim().toLocaleLowerCase();
    const current = byName.get(name);
    if (!current || preset.path === keepPath) byName.set(name, preset);
  }

  // Keep the newest-first order of each name's chosen copy.
  return ordered.filter((preset) => byName.get(preset.name.trim().toLocaleLowerCase()) === preset);
}

/**
 * The presets to show: the first few, plus the selected one if it would
 * otherwise be hidden, so the current choice is always visible.
 */
export function visiblePresets(presets: AlbumPreset[], selectedPath: string | null, expanded: boolean) {
  if (expanded || presets.length <= COLLAPSED_PRESET_COUNT) return { shown: presets, hidden: 0 };
  const shown = presets.slice(0, COLLAPSED_PRESET_COUNT);
  const selected = selectedPath ? presets.find((preset) => preset.path === selectedPath) : undefined;
  if (selected && !shown.includes(selected)) shown.push(selected);
  return { shown, hidden: presets.length - shown.length };
}
