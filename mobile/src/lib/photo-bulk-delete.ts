import { DataError, photoProcessing, type Photo, type PhotoDeleteOutcome } from '@/lib/data/types';

/** One confirmation deletes at most this many photos; select again for more. */
export const MAX_PHOTO_DELETES_PER_BATCH = 100;
/** Stop early instead of hammering a connection that keeps failing. */
const MAX_CONSECUTIVE_NETWORK_FAILURES = 3;

export type PhotoDeleteSummary = {
  /** Deleted now, or already gone after an earlier request: remove from the grid. */
  removed: string[];
  /** Refused because the worker may still write previews for them. */
  processing: number;
  /** Requests that failed (network/server); they may or may not be deleted. */
  failed: number;
  /** Photos not attempted because the batch stopped. */
  skipped: number;
  /** Signed out, left the album, or the connection kept failing. */
  stopped: boolean;
};

/** A photo can be selected for deletion unless the worker may still be writing it. */
export function isPhotoDeletable(photo: Photo): boolean {
  const { status } = photoProcessing(photo);
  return status !== 'pending' && status !== 'processing' && status !== 'uploading' && status !== 'finalizing';
}

/**
 * Deletes photos one at a time, never in parallel, so a large selection cannot
 * burst the server. Each request is a separate server decision; a lost reply
 * counts as failed, and asking again later answers "already gone".
 */
export async function deletePhotos(params: {
  photoIds: string[];
  remove: (photoId: string) => Promise<PhotoDeleteOutcome>;
  /** False once the account, album or screen this batch belongs to is gone. */
  isCurrent: () => boolean;
  onProgress?: (done: number, total: number) => void;
}): Promise<PhotoDeleteSummary> {
  const ids = [...new Set(params.photoIds)].slice(0, MAX_PHOTO_DELETES_PER_BATCH);
  const summary: PhotoDeleteSummary = { removed: [], processing: 0, failed: 0, skipped: 0, stopped: false };
  let networkFailures = 0;

  for (const [index, photoId] of ids.entries()) {
    if (!params.isCurrent()) {
      summary.stopped = true;
      summary.skipped = ids.length - index;
      break;
    }

    try {
      const outcome = await params.remove(photoId);
      networkFailures = 0;
      if (outcome === 'processing') summary.processing += 1;
      else summary.removed.push(photoId);
    } catch (error) {
      summary.failed += 1;
      const kind = error instanceof DataError ? error.kind : 'server';
      if (kind === 'unauthenticated' ||
        (kind === 'network' && ++networkFailures >= MAX_CONSECUTIVE_NETWORK_FAILURES)) {
        summary.stopped = true;
        summary.skipped = ids.length - index - 1;
        break;
      }
    }

    if (params.isCurrent()) params.onProgress?.(index + 1, ids.length);
  }

  return summary;
}
