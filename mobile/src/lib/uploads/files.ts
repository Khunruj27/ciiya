import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { ImagePickerAsset } from 'expo-image-picker';

import type { PreparedFile, UploadMimeType } from './types';

/** Mirrors the server's `MAX_DIRECT_PHOTO_UPLOAD_BYTES`. */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

const EXTENSIONS: Record<UploadMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// High enough that a converted HEIC is visually identical to its source,
// without ballooning to several times the original's size.
const CONVERTED_JPEG_QUALITY = 0.92;

/**
 * Queued photos live in the documents directory, not the cache: the system may
 * purge the cache at any time, which would silently drop a pending upload.
 */
function uploadsDirectory() {
  const directory = new Directory(Paths.document, 'uploads');
  if (!directory.exists) directory.create({ idempotent: true, intermediates: true });
  return directory;
}

export function queueFile() {
  return new File(uploadsDirectory(), 'queue.json');
}

export function localFile(localName: string) {
  return new File(uploadsDirectory(), localName);
}

export function deleteLocalFile(localName: string) {
  try {
    const file = localFile(localName);
    if (file.exists) file.delete();
  } catch {
    // A file that cannot be removed now is swept on the next launch.
  }
}

/** Removes stored photos that no queue item refers to any more. */
export function sweepLocalFiles(keep: Set<string>) {
  try {
    for (const entry of uploadsDirectory().list()) {
      if (entry instanceof File && entry.name !== 'queue.json' && !keep.has(entry.name)) {
        entry.delete();
      }
    }
  } catch {
    // Housekeeping only; the next launch tries again.
  }
}

function acceptedMimeType(value: string | null | undefined): UploadMimeType | null {
  const mimeType = String(value || '').toLowerCase();
  if (mimeType === 'image/jpg') return 'image/jpeg';
  return mimeType in EXTENSIONS ? (mimeType as UploadMimeType) : null;
}

/** The server checks that the name's extension matches the content type. */
function withExtension(fileName: string | null | undefined, mimeType: UploadMimeType) {
  const base = String(fileName || '')
    .replace(/\.[^./\\]+$/, '')
    .replace(/[\\/]/g, '-')
    .trim()
    .slice(0, 200);

  return `${base || 'photo'}.${EXTENSIONS[mimeType]}`;
}

/**
 * Copies one picked photo into the uploads directory, ready to send.
 *
 * The picker is asked for each photo's current file rather than a re-encoded
 * copy, so a JPEG, PNG or WebP is queued exactly as iOS hands it over — the
 * untouched original unless Photos itself holds an edited version. An iPhone
 * HEIC (or anything else the server does not take) is converted to a
 * full-resolution, high-quality JPEG first; that copy carries no EXIF data.
 *
 * Returns null for a photo that cannot be queued (unreadable, empty or larger
 * than the upload limit).
 */
export async function prepareAsset(asset: ImagePickerAsset): Promise<PreparedFile | null> {
  const id = randomUUID();
  let source = new File(asset.uri);
  let mimeType = acceptedMimeType(asset.mimeType);

  try {
    if (!source.exists) return null;

    if (!mimeType) {
      const rendered = await ImageManipulator.manipulate(asset.uri).renderAsync();
      const saved = await rendered.saveAsync({
        format: SaveFormat.JPEG,
        compress: CONVERTED_JPEG_QUALITY,
      });
      rendered.release();

      // The picker's copy of the original is no longer needed.
      source.delete();
      source = new File(saved.uri);
      mimeType = 'image/jpeg';
    }

    const localName = `${id}.${EXTENSIONS[mimeType]}`;
    const destination = localFile(localName);
    await source.move(destination);

    const info = destination.info({ md5: true });
    const sizeBytes = Number(info.size ?? destination.size) || 0;

    if (sizeBytes < 1 || sizeBytes > MAX_UPLOAD_BYTES || !info.md5) {
      deleteLocalFile(localName);
      return null;
    }

    return {
      fileName: withExtension(asset.fileName, mimeType),
      mimeType,
      sizeBytes,
      // The server hashes this again; it only has to be stable per content.
      fileHash: `ciiya-mobile:${info.md5}:${sizeBytes}`,
      localName,
    };
  } catch {
    try {
      if (source.exists) source.delete();
    } catch {
      // The picker's cache copy is cleared by the system eventually.
    }
    return null;
  }
}
