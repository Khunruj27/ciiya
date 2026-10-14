import type { Photo, PhotoPage } from './types';
import { shouldPollPhoto } from './types';

export type PhotoFeedState = PhotoPage & {
  status: 'loading' | 'ready' | 'error';
  error: unknown;
  errorSource: 'latest' | 'more' | null;
  loadingMore: boolean;
  refreshing: boolean;
  processingError: boolean;
};

export const PROCESSING_UPDATE_BATCH_SIZE = 120;

function uniquePhotos(photos: Photo[]): Photo[] {
  return [...new Map(photos.map((photo) => [photo.id, photo])).values()];
}

/**
 * Keep the older loaded range only when the new first page overlaps it. If a
 * whole page (or more) was inserted, there is an unknown gap between ranges:
 * adopting the new page AND its cursor makes the next scroll fill that gap.
 * Keeping the old cursor there silently skips new photos.
 */
export function mergeLatestPhotoPage(previous: PhotoPage, incoming: PhotoPage): PhotoPage {
  const photos = uniquePhotos(incoming.photos);
  const known = new Set(previous.photos.map((photo) => photo.id));
  const overlaps = photos.some((photo) => known.has(photo.id));

  if (!overlaps || incoming.nextCursor === null) {
    return { photos, nextCursor: incoming.nextCursor };
  }

  const fresh = new Set(photos.map((photo) => photo.id));
  return {
    photos: [...photos, ...previous.photos.filter((photo) => !fresh.has(photo.id))],
    nextCursor: previous.nextCursor,
  };
}

export function appendPhotoPage(previous: PhotoPage, incoming: PhotoPage): PhotoPage {
  const fresh = new Map(incoming.photos.map((photo) => [photo.id, photo]));
  const known = new Set(previous.photos.map((photo) => photo.id));
  return {
    photos: [
      ...previous.photos.map((photo) => fresh.get(photo.id) ?? photo),
      ...uniquePhotos(incoming.photos).filter((photo) => !known.has(photo.id)),
    ],
    nextCursor: incoming.nextCursor,
  };
}

/** Processing updates are not a page: they must never replace its boundary. */
export function updateLoadedPhotos(previous: PhotoPage, updates: Photo[]): PhotoPage {
  const fresh = new Map(updates.map((photo) => [photo.id, photo]));
  return {
    ...previous,
    photos: previous.photos.map((photo) => fresh.get(photo.id) ?? photo),
  };
}

type PhotoFeedSource = {
  fetchPage(cursor?: string | null): Promise<PhotoPage>;
  fetchUpdates(ids: string[]): Promise<Photo[]>;
};

/**
 * Small external store so request guards are synchronous, not a render late.
 * A refresh invalidates older load-more/poll results; newer refreshes win.
 * No React, timers, device APIs, credentials or network configuration here.
 */
export class PhotoFeed {
  private state: PhotoFeedState = {
    photos: [], nextCursor: null, status: 'loading', error: null, errorSource: null,
    loadingMore: false, refreshing: false, processingError: false,
  };
  private listeners = new Set<() => void>();
  private generation = 0;
  private latestPending = false;
  private polling = false;
  private pollOffset = 0;
  private disposed = false;

  constructor(private readonly source: PhotoFeedSource) {}

  getSnapshot = (): PhotoFeedState => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(state: PhotoFeedState) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }

  /** Also reactivates after React's development effect cleanup/replay. */
  reload = async (showSpinner = false) => {
    this.disposed = false;
    await this.refresh('replace', showSpinner);
  };

  refreshLatest = async (showSpinner = false) => {
    if (!this.disposed) await this.refresh('merge', showSpinner);
  };

  private async refresh(mode: 'replace' | 'merge', showSpinner: boolean) {
    const generation = ++this.generation;
    this.latestPending = true;
    this.polling = false;
    this.publish({ ...this.state, loadingMore: false, refreshing: showSpinner });

    try {
      const page = await this.source.fetchPage();
      if (this.disposed || generation !== this.generation) return;
      const next = mode === 'merge' && this.state.status === 'ready'
        ? mergeLatestPhotoPage(this.state, page)
        : { photos: uniquePhotos(page.photos), nextCursor: page.nextCursor };
      this.publish({ ...next, status: 'ready', error: null, errorSource: null, loadingMore: false, refreshing: false,
        processingError: mode === 'replace' ? false : this.state.processingError });
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      this.publish({
        ...this.state,
        status: this.state.photos.length ? 'ready' : 'error',
        error, errorSource: 'latest', loadingMore: false, refreshing: false,
      });
    } finally {
      if (generation === this.generation) this.latestPending = false;
    }
  }

  loadMore = async () => {
    const cursor = this.state.nextCursor;
    if (this.disposed || this.latestPending || this.state.loadingMore || !cursor) return;
    const generation = this.generation;
    this.publish({ ...this.state, loadingMore: true });

    try {
      const page = await this.source.fetchPage(cursor);
      if (this.disposed || generation !== this.generation || this.state.nextCursor !== cursor) return;
      this.publish({
        ...this.state, ...appendPhotoPage(this.state, page), loadingMore: false,
        // A successful older page does not resolve a failed head refresh.
        ...(this.state.errorSource === 'more' ? { error: null, errorSource: null } : {}),
      });
    } catch (error) {
      if (this.disposed || generation !== this.generation || this.state.nextCursor !== cursor) return;
      // Keep the loaded range and its cursor, but make the failure retryable.
      this.publish({ ...this.state, error, errorSource: 'more', loadingMore: false });
    } finally {
      if (!this.disposed && generation === this.generation) {
        this.publish({ ...this.state, loadingMore: false });
      }
    }
  };

  refreshProcessing = async () => {
    if (this.disposed || this.latestPending || this.polling) return;
    const pending = this.state.photos.filter(shouldPollPhoto).map((photo) => photo.id);
    if (!pending.length) return;
    // Rotate bounded batches so a stalled first photo cannot block older ones.
    const start = this.pollOffset % pending.length;
    const ids = [...pending.slice(start), ...pending.slice(0, start)].slice(0, PROCESSING_UPDATE_BATCH_SIZE);
    this.pollOffset = (start + ids.length) % pending.length;
    const generation = this.generation;
    this.polling = true;

    try {
      const updates = await this.source.fetchUpdates(ids);
      if (this.disposed || generation !== this.generation) return;
      this.publish({ ...this.state, ...updateLoadedPhotos(this.state, updates), processingError: false });
    } catch {
      if (this.disposed || generation !== this.generation) return;
      // Keep cached photos, but do not present stale processing readings as current.
      this.publish({ ...this.state, processingError: true });
    } finally {
      if (generation === this.generation) this.polling = false;
    }
  };

  dispose = () => {
    this.disposed = true;
    this.generation += 1;
    this.latestPending = false;
    this.polling = false;
  };
}
