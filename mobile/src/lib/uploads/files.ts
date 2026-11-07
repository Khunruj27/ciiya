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

export function queueFile(name: 'queue.json' | 'queue.next.json' = 'queue.json') {
  return new File(uploadsDirectory(), name);
}

/** Write the replacement completely before replacing the previous journal. */
export function saveQueue(contents: string) {
  const next = queueFile('queue.next.json');
  next.create({ overwrite: true });
  next.write(contents);
  next.moveSync(queueFile(), { overwrite: true });
}

export function localFile(localName: string) {
  if (!/^[A-Za-z0-9-]+\.(jpg|png|webp)$/.test(localName)) {
    throw new Error('Invalid upload copy name');
  }
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
      if (
        entry instanceof File &&
        /^[A-Za-z0-9-]+\.(jpg|png|webp)$/.test(entry.name) &&
        !keep.has(entry.name)
      ) {
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
  let generated: File | null = null;
  let localName: string | null = null;
  let mimeType = acceptedMimeType(asset.mimeType);

  try {
    let source = new File(asset.uri);
    if (!source.exists) return null;

    if (!mimeType) {
      const context = ImageManipulator.manipulate(asset.uri);
      try {
        const rendered = await context.renderAsync();
        try {
          const saved = await rendered.saveAsync({
            format: SaveFormat.JPEG,
            compress: CONVERTED_JPEG_QUALITY,
          });
          generated = new File(saved.uri);
        } finally {
          rendered.release();
        }
      } finally {
        context.release();
      }
      source = generated;
      mimeType = 'image/jpeg';
    }

    localName = `${id}.${EXTENSIONS[mimeType]}`;
    const destination = localFile(localName);
    // A picker URI may refer to an original, not a disposable cache copy.
    await source.copy(destination);

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
    if (localName) deleteLocalFile(localName);
    return null;
  } finally {
    // Only the conversion output created above belongs to us.
    try {
      if (generated?.exists) generated.delete();
    } catch {
      // The system eventually clears this generated cache copy.
    }
  }
}
