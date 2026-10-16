import { DataError, photoProcessing, type Photo, type PhotoReprocessOutcome } from '@/lib/data/types';

/** One confirmation sends at most this many photos; select again for more. */
export const MAX_PHOTO_REPROCESS_PER_BATCH = 100;
/** Stop early instead of hammering a connection that keeps failing. */
const MAX_CONSECUTIVE_NETWORK_FAILURES = 3;

export type PhotoReprocessSummary = {
  /** Photos the worker will render again (their thumbnails update later). */
  queued: string[];
  alreadyQueued: number;
  sourceMissing: number;
  notReprocessable: number;
  /** Requests that failed (network/server); safe to try again later. */
  failed: number;
  /** Photos not attempted because the batch stopped. */
  skipped: number;
  /** Signed out, left the album, or the connection kept failing. */
  stopped: boolean;
};

/** Only a finished photo can be rendered again; failed ones use retry instead. */
export function isPhotoReprocessable(photo: Photo): boolean {
  return photoProcessing(photo).status === 'ready';
}

/**
 * Sends photos one at a time, never in parallel, so a large selection cannot
 * burst the server. Each request is a separate, idempotent server decision; a
 * lost reply counts as failed and asking again answers "already queued".
 */
export async function reprocessPhotos(params: {
  photoIds: string[];
  reprocess: (photoId: string) => Promise<PhotoReprocessOutcome>;
  /** False once the account, album or screen this batch belongs to is gone. */
  isCurrent: () => boolean;
  onProgress?: (done: number, total: number) => void;
}): Promise<PhotoReprocessSummary> {
  const ids = [...new Set(params.photoIds)].slice(0, MAX_PHOTO_REPROCESS_PER_BATCH);
  const summary: PhotoReprocessSummary = {
    queued: [], alreadyQueued: 0, sourceMissing: 0, notReprocessable: 0, failed: 0, skipped: 0, stopped: false,
  };
  let networkFailures = 0;

  for (const [index, photoId] of ids.entries()) {
    if (!params.isCurrent()) {
      summary.stopped = true;
      summary.skipped = ids.length - index;
      break;
    }

    try {
      const outcome = await params.reprocess(photoId);
      networkFailures = 0;
      if (outcome === 'queued') summary.queued.push(photoId);
      else if (outcome === 'already-queued') summary.alreadyQueued += 1;
      else if (outcome === 'source-missing') summary.sourceMissing += 1;
      else summary.notReprocessable += 1;
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
