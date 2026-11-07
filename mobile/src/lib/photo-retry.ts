import { DataError, photoProcessing, type Photo, type PhotoRetryOutcome } from '@/lib/data/types';

/** One tap sends at most this many photos; the owner can tap again for more. */
export const MAX_PHOTO_RETRIES_PER_TAP = 50;
/** Stop early instead of hammering a connection that keeps failing. */
const MAX_CONSECUTIVE_NETWORK_FAILURES = 3;

export type PhotoRetrySummary = {
  /** Photos the worker will process again (show them as waiting). */
  queued: string[];
  alreadyQueued: number;
  sourceMissing: number;
  notRetryable: number;
  /** Requests that failed (network/server); safe to try again later. */
  failed: number;
  /** Photos not attempted because the batch stopped. */
  skipped: number;
  /** Signed out, left the album, or the connection kept failing. */
  stopped: boolean;
};

/** Loaded photos the owner may send back to the worker, oldest problem first. */
export function retryablePhotos(photos: Photo[]): Photo[] {
  return photos.filter((photo) => {
    const { status } = photoProcessing(photo);
    return status === 'failed' || status === 'cancelled';
  });
}

/**
 * Sends photos one at a time, never in parallel, so a large album cannot burst
 * the server. Each request is a separate, idempotent server decision; a lost
 * reply is counted as failed and a later tap simply asks again.
 */
export async function retryPhotos(params: {
  photoIds: string[];
  retry: (photoId: string) => Promise<PhotoRetryOutcome>;
  /** False once the account, album or screen this batch belongs to is gone. */
  isCurrent: () => boolean;
  onProgress?: (done: number, total: number) => void;
}): Promise<PhotoRetrySummary> {
  const ids = [...new Set(params.photoIds)].slice(0, MAX_PHOTO_RETRIES_PER_TAP);
  const summary: PhotoRetrySummary = {
    queued: [], alreadyQueued: 0, sourceMissing: 0, notRetryable: 0, failed: 0, skipped: 0, stopped: false,
  };
  let networkFailures = 0;

  for (const [index, photoId] of ids.entries()) {
    if (!params.isCurrent()) {
      summary.stopped = true;
      summary.skipped = ids.length - index;
      break;
    }

    try {
      const outcome = await params.retry(photoId);
      networkFailures = 0;
      if (outcome === 'queued') summary.queued.push(photoId);
      else if (outcome === 'already-queued') summary.alreadyQueued += 1;
      else if (outcome === 'source-missing') summary.sourceMissing += 1;
      else summary.notRetryable += 1;
    } catch (error) {
      summary.failed += 1;
      const kind = error instanceof DataError ? error.kind : 'server';
      if (kind === 'unauthenticated') {
        summary.stopped = true;
        summary.skipped = ids.length - index - 1;
        break;
      }
      if (kind === 'network' && ++networkFailures >= MAX_CONSECUTIVE_NETWORK_FAILURES) {
        summary.stopped = true;
        summary.skipped = ids.length - index - 1;
        break;
      }
    }

    if (params.isCurrent()) params.onProgress?.(index + 1, ids.length);
  }

  return summary;
}
