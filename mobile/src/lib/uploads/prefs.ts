import { File, Paths } from 'expo-file-system';

import type { UploadSize } from './types';

/**
 * Remembers the delivery size the photographer last uploaded with, so a whole
 * job keeps one setting without picking it again for every batch.
 */

const SIZES: UploadSize[] = ['sd', 'hd', 'uhd', 'original'];
// Full resolution by default, matching the website's uploader.
const DEFAULT_SIZE: UploadSize = 'original';

let cached: UploadSize | null = null;
let presets: Record<string, string> | null = null;

type SavedPrefs = { size?: unknown; presets?: unknown };

function readPrefs(): SavedPrefs | null {
  try {
    const file = prefsFile();
    return file.exists ? (JSON.parse(file.textSync()) as SavedPrefs) : null;
  } catch {
    return null;
  }
}

function writePrefs() {
  try {
    prefsFile().write(JSON.stringify({ size: getPreferredUploadSize(), presets: loadPresets() }));
  } catch {
    // Only a convenience; the choice still applies to this batch.
  }
}

function loadPresets(): Record<string, string> {
  if (presets) return presets;
  const saved = readPrefs()?.presets;
  presets = {};
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
    for (const [albumId, path] of Object.entries(saved as Record<string, unknown>)) {
      if (typeof path === 'string' && path.toLowerCase().endsWith('.xmp')) presets[albumId] = path;
    }
  }
  return presets;
}

/** The preset last used for this album; it may no longer be offered. */
export function getPreferredPreset(albumId: string): string | null {
  return loadPresets()[albumId] ?? null;
}

export function setPreferredPreset(albumId: string, path: string | null) {
  const current = loadPresets();
  if (path) current[albumId] = path;
  else delete current[albumId];
  writePrefs();
}

function prefsFile() {
  return new File(Paths.document, 'upload-prefs.json');
}

export function getPreferredUploadSize(): UploadSize {
  if (cached) return cached;

  const saved = readPrefs();
  cached = SIZES.find((size) => size === saved?.size) ?? DEFAULT_SIZE;
  return cached;
}

export function setPreferredUploadSize(size: UploadSize) {
  cached = size;
  writePrefs();
}
