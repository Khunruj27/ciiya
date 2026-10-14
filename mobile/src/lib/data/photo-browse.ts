import type { Photo } from './types';

export type PhotoReadinessFilter = 'all' | 'ready' | 'not-ready' | 'failed';

function searchText(text: string) {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
}

export function isPhotoBrowseFiltered(query: string, filter: PhotoReadinessFilter) {
  return Boolean(searchText(query)) || filter !== 'all';
}

/** Filename-only local search, in existing feed order; no URL/id search or I/O. */
export function selectPhotos(photos: readonly Photo[], query: string, filter: PhotoReadinessFilter): Photo[] {
  const words = searchText(query.slice(0, 200)).split(' ').filter(Boolean);
  return photos.filter(photo => {
    if (filter === 'ready' && photo.isReady !== true) return false;
    if (filter === 'not-ready' && photo.isReady === true) return false;
    if (filter === 'failed' && (photo.isReady === true || photo.processingStatus !== 'failed')) return false;
    const name = searchText(photo.filename ?? '');
    return words.every(word => name.includes(word));
  });
}

/** Not-ready is not a diagnosis of failed jobs, nor evidence of a healthy worker. */
export function loadedPhotoReadiness(photos: readonly Photo[]) {
  const ready = photos.filter(photo => photo.isReady === true).length;
  return { ready, notReady: photos.length - ready, loaded: photos.length };
}

export function loadedProcessingCounts(photos: readonly Photo[]) {
  const counts = { waiting: 0, working: 0, failed: 0, stopped: 0, unknown: 0, preparing: 0 };
  for (const photo of photos) {
    if (photo.isReady === true) continue;
    if (photo.processingStatus === 'pending') counts.waiting++;
    else if (['processing', 'uploading', 'finalizing'].includes(photo.processingStatus ?? '')) counts.working++;
    else if (photo.processingStatus === 'failed') counts.failed++;
    else if (photo.processingStatus === 'cancelled') counts.stopped++;
    else if (photo.processingStatus === 'done') counts.preparing++;
    else counts.unknown++;
  }
  return counts;
}

/** Freeze the filtered pager's IDs, but keep live previews/readiness by identity. */
export function frozenPhotoSelection(ids: readonly string[], photos: readonly Photo[]): Photo[] {
  if (!ids.length || new Set(ids).size !== ids.length) return [];
  const byId = new Map(photos.map(photo => [photo.id, photo]));
  const result: Photo[] = [];
  for (const id of ids) {
    const photo = byId.get(id);
    // Removing an ID must close the viewer, never shift its numeric swipe index.
    if (!photo) return [];
    result.push(photo);
  }
  return result;
}
