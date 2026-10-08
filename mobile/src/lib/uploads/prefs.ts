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

function prefsFile() {
  return new File(Paths.document, 'upload-prefs.json');
}

export function getPreferredUploadSize(): UploadSize {
  if (cached) return cached;

  try {
    const file = prefsFile();
    const saved = file.exists ? (JSON.parse(file.textSync()) as { size?: unknown }) : null;
    cached = SIZES.find((size) => size === saved?.size) ?? DEFAULT_SIZE;
  } catch {
    cached = DEFAULT_SIZE;
  }

  return cached;
}

export function setPreferredUploadSize(size: UploadSize) {
  cached = size;

  try {
    prefsFile().write(JSON.stringify({ size }));
  } catch {
    // Only a convenience; the choice still applies to this batch.
  }
}
