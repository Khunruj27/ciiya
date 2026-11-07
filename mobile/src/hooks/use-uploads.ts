import { useSyncExternalStore } from 'react';

import { getUploads, subscribeToUploads } from '@/lib/uploads/queue';
import { canRetryUpload, isUploadHeld, uploadProgress } from '@/lib/uploads/review';
import type { UploadItem } from '@/lib/uploads/types';

/** Every upload in the signed-in photographer's queue, oldest first. */
export function useUploads(): UploadItem[] {
  return useSyncExternalStore(subscribeToUploads, getUploads, getUploads);
}

export type UploadSummary = {
  total: number;
  /** Queued, sending or being registered. */
  active: number;
  /** Stored in the album, including photos it already had. */
  finished: number;
  /** Of those, the photos the album already had (nothing was added). */
  duplicates: number;
  failed: number;
  /** Failed uploads that can be sent again (their file is still on the phone). */
  retryable: number;
  /** Nothing is sending and the queue is waiting to retry after a dropped connection. */
  waitingForNetwork: boolean;
  /** 0–1 across the whole batch. */
  progress: number;
};

export function summarizeUploads(items: UploadItem[]): UploadSummary {
  let active = 0;
  let finished = 0;
  let duplicates = 0;
  let failed = 0;
  let retryable = 0;
  let sent = 0;
  let sending = 0;
  let stalled = false;

  for (const item of items) {
    if (isUploadHeld(item)) {
      failed += 1;
    } else if (item.status === 'done' || item.status === 'duplicate') {
      finished += 1;
      sent += 1;
      if (item.status === 'duplicate') duplicates += 1;
    } else if (item.status === 'failed') {
      failed += 1;
      if (canRetryUpload(item)) retryable += 1;
    } else {
      active += 1;
      sent += uploadProgress(item.progress);
      if (item.status === 'queued') {
        if (item.failure === 'network') stalled = true;
      } else {
        sending += 1;
      }
    }
  }

  const counted = finished + active;

  return {
    total: items.length,
    active,
    finished,
    duplicates,
    failed,
    retryable,
    // Only when nothing is getting through; one retry behind a moving queue is not a stall.
    waitingForNetwork: stalled && sending === 0,
    progress: counted > 0 ? sent / counted : 0,
  };
}

/** The queue for one album, with its running totals. */
export function useAlbumUploads(albumId: string) {
  const items = useUploads().filter((item) => item.albumId === albumId);
  return { items, summary: summarizeUploads(items) };
}
