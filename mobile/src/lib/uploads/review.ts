import type { UploadItem } from './types';

/** Stored in the album is not the same as processed/ready for delivery. */
export function isUploadFinished(item: UploadItem) {
  return item.status === 'done' || item.status === 'duplicate';
}

/** Legacy Supabase journals stay available for explicit review, not a new send. */
export function isUploadHeld(item: UploadItem) {
  return Boolean(item.staged);
}

export function canRetryUpload(item: UploadItem) {
  return !isUploadHeld(item) && item.status === 'failed' && item.failure !== 'file-missing';
}

/** Never forget a legacy repair source or an unacknowledged registration. */
export function canRemoveUpload(item: UploadItem) {
  return !isUploadFinished(item) && !isUploadHeld(item) && !item.registering &&
    item.status !== 'finishing';
}

export function uploadProgress(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.min(value, 1)) : 0;
}

export function reviewUploads(items: UploadItem[]) {
  const review = {
    queued: 0, uploading: 0, finishing: 0, stored: 0, duplicates: 0,
    failed: 0, held: 0, retryable: 0,
  };
  for (const item of items) {
    if (isUploadHeld(item)) review.held += 1;
    else if (item.status === 'queued') review.queued += 1;
    else if (item.status === 'uploading') review.uploading += 1;
    else if (item.status === 'finishing') review.finishing += 1;
    else if (item.status === 'done') review.stored += 1;
    else if (item.status === 'duplicate') review.duplicates += 1;
    else if (item.status === 'failed') review.failed += 1;
    if (canRetryUpload(item)) review.retryable += 1;
  }
  return review;
}

type ReviewPorts = {
  albumId: string;
  /** Read-only account/album/focus lifetime capture; no auth or network lookup. */
  capture: () => (() => boolean) | null;
  getItems: () => UploadItem[];
  retry: (id: string) => void;
  remove: (id: string) => void;
  clearFinished: (albumId: string) => void;
};

/** Only human taps invoke existing queue operations; this never pumps a queue. */
export function createUploadReviewActions(ports: ReviewPorts) {
  let confirmationPending = false;
  const scoped = () => ports.getItems().filter((item) => item.albumId === ports.albumId);

  function retry(id?: string) {
    if (confirmationPending) return;
    const current = ports.capture();
    if (!current?.()) return;
    const eligible = scoped().filter((item) => (id === undefined || item.id === id) && canRetryUpload(item));
    for (const candidate of eligible) {
      if (!current()) return;
      const fresh = scoped().find((item) => item.id === candidate.id);
      if (fresh && fresh.ownerId === candidate.ownerId && canRetryUpload(fresh)) {
        ports.retry(fresh.id);
      }
    }
  }

  function requestRemove(id: string) {
    if (confirmationPending) return null;
    const current = ports.capture();
    if (!current?.()) return null;
    const candidate = scoped().find((item) => item.id === id);
    if (!candidate || !canRemoveUpload(candidate)) return null;
    const selected = candidate;
    confirmationPending = true;
    let settled = false;
    function finish(confirm: boolean) {
      if (settled) return;
      settled = true;
      confirmationPending = false;
      if (!confirm || !current?.()) return;
      // A transfer may have finished, started registration or disappeared while
      // the dialog was open. Never use its stale rendered state to remove it.
      const fresh = scoped().find((item) => item.id === selected.id);
      if (fresh && fresh.ownerId === selected.ownerId &&
        fresh.localName === selected.localName && fresh.fileHash === selected.fileHash &&
        canRemoveUpload(fresh)) ports.remove(fresh.id);
    }
    return {
      fileName: candidate.fileName,
      confirm: () => finish(true),
      cancel: () => finish(false),
    };
  }

  function clearFinished() {
    if (confirmationPending) return;
    const current = ports.capture();
    if (!current?.()) return;
    const review = reviewUploads(scoped());
    if (review.queued + review.uploading + review.finishing === 0 && review.held === 0 &&
      review.stored + review.duplicates > 0) ports.clearFinished(ports.albumId);
  }

  return { retry, requestRemove, clearFinished };
}
