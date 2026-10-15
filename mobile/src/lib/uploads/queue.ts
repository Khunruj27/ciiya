import { randomUUID } from 'expo-crypto';
import type { ImagePickerAsset } from 'expo-image-picker';
import { AppState } from 'react-native';

import { isDemoMode } from '@/lib/config';

import { demoTransport } from './demo-transport';
import { deleteLocalFile, localFile, prepareAsset, queueFile, saveQueue, sweepLocalFiles } from './files';
import { liveTransport } from './live-transport';
import {
  UploadError,
  type UploadFailure,
  type UploadItem,
  type UploadOptions,
  type UploadTransport,
} from './types';

/**
 * The upload queue: photos picked on the phone are copied into the app, listed
 * here, and sent a couple at a time. The list is saved to disk on every change
 * of state, so closing the app, losing signal or a crash never loses a photo —
 * whatever was unfinished starts again the next time the app is open.
 */

const CONCURRENCY = 2;
// A dropped connection is retried for as long as it takes; these are the waits.
const NETWORK_RETRY_DELAYS_MS = [3_000, 10_000, 30_000, 60_000];
// A server-side refusal that might pass is given a few tries, then shown.
const MAX_SERVER_ATTEMPTS = 5;
const SERVER_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000];
const PERSIST_DELAY_MS = 400;
const QUEUE_VERSION = 1;

const transport: UploadTransport = isDemoMode ? demoTransport : liveTransport;

let items: UploadItem[] = [];
let visibleItems: UploadItem[] = [];
let ownerId: string | null = null;
let ownerGeneration = 0;
let hydrated = false;
/** Set when the server stops accepting the session; cleared by resuming. */
let awaitingSignIn = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

const listeners = new Set<() => void>();
const running = new Map<string, AbortController>();
// Running cancellations are cleaned up only once their transport has settled.
const discarded = new Map<string, UploadItem>();
const foreignLocalCleanup = new Map<string, string>();
const notBefore = new Map<string, number>();

function emit() {
  visibleItems = ownerId ? items.filter((item) => item.ownerId === ownerId) : [];
  for (const listener of listeners) listener();
}

function persistNow(required = false) {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = null;

  try {
    // Finished uploads are only kept for the current session's summary.
    const pending = items.filter((item) => item.status !== 'done' && item.status !== 'duplicate');
    saveQueue(JSON.stringify({ version: QUEUE_VERSION, items: pending }));
    return true;
  } catch {
    // Never send a registration that cannot survive a crash on this phone.
    if (required) throw new UploadError('server', { message: 'Could not save the upload queue' });
    return false;
  }
}

function setItems(next: UploadItem[], options: { persist?: boolean } = {}) {
  items = next;
  emit();

  if (options.persist !== false && !persistTimer) {
    persistTimer = setTimeout(() => persistNow(), PERSIST_DELAY_MS);
  }
}

function find(id: string) {
  return items.find((item) => item.id === id);
}

function patch(id: string, changes: Partial<UploadItem>, options?: { persist?: boolean }) {
  if (!find(id)) return;
  setItems(
    items.map((item) => (item.id === id ? { ...item, ...changes } : item)),
    options
  );
}

function isUploadItem(value: unknown): value is UploadItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;

  return (
    typeof item.id === 'string' &&
    typeof item.ownerId === 'string' &&
    typeof item.albumId === 'string' &&
    typeof item.fileName === 'string' &&
    typeof item.mimeType === 'string' &&
    typeof item.sizeBytes === 'number' && Number.isFinite(item.sizeBytes) && item.sizeBytes > 0 &&
    typeof item.fileHash === 'string' &&
    typeof item.localName === 'string' &&
    /^[A-Za-z0-9-]+\.(jpg|png|webp)$/.test(item.localName) &&
    ['image/jpeg', 'image/png', 'image/webp'].includes(String(item.mimeType)) &&
    ['sd', 'hd', 'uhd', 'original'].includes(String(item.size)) &&
    ['queued', 'uploading', 'finishing', 'done', 'duplicate', 'failed'].includes(String(item.status)) &&
    typeof item.autoFaceScan === 'boolean' && typeof item.autoPublish === 'boolean' &&
    (item.presetPath === undefined || item.presetPath === null ||
      (typeof item.presetPath === 'string' && /^[A-Za-z0-9/._-]{1,500}\.xmp$/i.test(item.presetPath) &&
        !item.presetPath.includes('..') && !item.presetPath.includes('//'))) &&
    typeof item.attempts === 'number' && Number.isFinite(item.attempts) && item.attempts >= 0 &&
    typeof item.createdAt === 'number' && Number.isFinite(item.createdAt)
  );
}

/** Reads the saved queue once per launch. */
function hydrate() {
  if (hydrated) return;
  hydrated = true;

  let restored: UploadItem[] = [];
  let safeToSweep = true;

  // A failed replacement may leave the fully written next journal recoverable.
  for (const name of ['queue.json', 'queue.next.json'] as const) {
    try {
      const file = queueFile(name);
      if (!file.exists) continue;
      safeToSweep = false;
      const saved = JSON.parse(file.textSync()) as { version?: number; items?: unknown };
      if (saved.version === QUEUE_VERSION && Array.isArray(saved.items)) {
        restored = saved.items.filter(isUploadItem);
        safeToSweep = restored.length === saved.items.length;
        break;
      }
    } catch {
      safeToSweep = false;
    }
  }

  items = restored.map((saved): UploadItem => {
    const staged = saved.staged;
    const item: UploadItem = {
      ...saved,
      registering: saved.registering === true,
      presetPath: typeof saved.presetPath === 'string' ? saved.presetPath : null,
      staged:
        staged && typeof staged.storagePath === 'string'
          ? {
              storagePath: staged.storagePath,
              // Older journals set registering but not uncertain before sending.
              uncertain: staged.uncertain === true || saved.registering === true,
            }
          : null,
    };

    if (!localFile(item.localName).exists) {
      return { ...item, status: 'failed', failure: 'file-missing', progress: 0 };
    }
    // Whatever was mid-flight when the app closed simply starts again.
    if (item.status === 'uploading' || item.status === 'finishing') {
      return { ...item, status: 'queued', progress: 0 };
    }
    return { ...item, progress: 0 };
  });

  // Do not destroy recoverable local photos when a journal cannot be read.
  if (safeToSweep) {
    sweepLocalFiles(new Set(items.map((item) => item.localName)));
  }
  emit();
}

function retryDelay(delays: number[], attempt: number) {
  return delays[Math.min(Math.max(attempt - 1, 0), delays.length - 1)];
}

function pump() {
  if (!ownerId || awaitingSignIn) return;

  const now = Date.now();

  for (const item of items) {
    if (running.size >= CONCURRENCY) return;
    if (item.status !== 'queued' || item.ownerId !== ownerId || running.has(item.id)) continue;
    if ((notBefore.get(item.id) ?? 0) > now) continue;

    void run(item.id);
  }
}

function settleFailure(item: UploadItem, error: unknown) {
  const failure: UploadFailure = error instanceof UploadError ? error.failure : 'server';
  const retryable = error instanceof UploadError ? error.retryable : true;
  const attempts = item.attempts + 1;

  const isNetwork = failure === 'network';
  const canRetry = retryable && (isNetwork || attempts < MAX_SERVER_ATTEMPTS);

  if (canRetry) {
    const delay = retryDelay(isNetwork ? NETWORK_RETRY_DELAYS_MS : SERVER_RETRY_DELAYS_MS, attempts);
    notBefore.set(item.id, Date.now() + delay);
    patch(item.id, { status: 'queued', progress: 0, attempts, failure });
    setTimeout(pump, delay + 50);
    return;
  }

  patch(item.id, { status: 'failed', progress: 0, attempts, failure });

  if (failure === 'file-missing') deleteLocalFile(item.localName);

  if (failure === 'storage-full' || failure === 'session') {
    // The rest would stop for the same reason; say so once instead of one by one.
    setItems(
      items.map((other): UploadItem =>
        other.ownerId === item.ownerId && other.status === 'queued' && !running.has(other.id)
          ? { ...other, status: 'failed', failure, progress: 0 }
          : other
      )
    );
  }
}

async function run(id: string) {
  const initial = find(id);
  if (!initial || initial.ownerId !== ownerId) return;
  const generation = ownerGeneration;
  const controller = new AbortController();
  running.set(id, controller);
  notBefore.delete(id);
  patch(id, { status: 'uploading', progress: 0 });

  let reported = 0;

  try {
    const item = find(id);
    if (!item) return;
    persistNow(true);

    function assertCurrentOwner() {
      if (controller.signal.aborted || generation !== ownerGeneration || ownerId !== item?.ownerId) {
        controller.abort();
        throw new Error('Upload no longer belongs to the active session');
      }
    }

    const outcome = await transport.upload(item, {
      signal: controller.signal,
      onProgress(progress) {
        if (controller.signal.aborted || generation !== ownerGeneration) return;
        // Skip tiny steps so a fast upload does not redraw on every chunk.
        if (progress - reported < 0.02 && progress < 1) return;
        reported = progress;
        patch(id, { progress }, { persist: false });
      },
      onFinishing() {
        assertCurrentOwner();
        patch(id, { status: 'finishing', progress: 1, registering: true });
        persistNow(true);
      },
      onStaged(staged) {
        const removed = discarded.get(id);
        if (removed) discarded.set(id, { ...removed, staged });
        assertCurrentOwner();
        patch(id, { staged });
        // Saved straight away: losing this would orphan or re-send the file.
        persistNow(true);
      },
    });

    const finished = find(id);
    if (finished) {
      // "Already there" after our own registration request is that request having worked.
      const status = outcome === 'duplicate' && item.registering ? 'done' : outcome;
      patch(id, { status, progress: 1, failure: null });
      // If the process closes now, the journal must not restore a missing file.
      if (persistNow()) deleteLocalFile(finished.localName);
    }
  } catch (error) {
    const current = find(id);

    if (!current) {
      // Removed by the photographer while it was running.
    } else if (controller.signal.aborted) {
      patch(id, { status: 'queued', progress: 0 });
    } else if (error instanceof UploadError && error.signedOut) {
      awaitingSignIn = true;
      patch(id, { status: 'queued', progress: 0 });
    } else {
      settleFailure(current, error);
    }
  } finally {
    running.delete(id);
    const removed = discarded.get(id);
    if (removed) {
      discarded.delete(id);
      transport.discard?.(removed);
      deleteLocalFile(removed.localName);
    }
    const foreignLocalName = foreignLocalCleanup.get(id);
    if (foreignLocalName) {
      foreignLocalCleanup.delete(id);
      deleteLocalFile(foreignLocalName);
    }
    pump();
  }
}

/** Tells the queue who is signed in; `null` pauses it without losing anything. */
export function setUploadOwner(userId: string | null) {
  hydrate();
  if (ownerId !== userId) ownerGeneration += 1;
  ownerId = userId;
  awaitingSignIn = false;

  if (!userId) {
    for (const controller of running.values()) controller.abort();
    emit();
    return;
  }

  // Another account's queued photos must not stay on, or be sent from, this phone.
  const foreign = items.filter((item) => item.ownerId !== userId);

  if (foreign.length > 0) {
    for (const item of foreign) {
      const controller = running.get(item.id);
      if (controller) {
        foreignLocalCleanup.set(item.id, item.localName);
        controller.abort();
      } else {
        deleteLocalFile(item.localName);
      }
    }
    setItems(items.filter((item) => item.ownerId === userId));
    persistNow();
  }

  // A fresh sign-in is what uploads stopped for an expired session were waiting on.
  if (items.some((item) => item.status === 'failed' && item.failure === 'session')) {
    setItems(
      items.map((item): UploadItem =>
        item.status === 'failed' && item.failure === 'session'
          ? { ...item, status: 'queued', attempts: 0, failure: null }
          : item
      )
    );
  }

  emit();
  pump();
}

/** Tries waiting uploads now, e.g. when the app returns to the foreground. */
export function resumeUploads() {
  awaitingSignIn = false;
  notBefore.clear();
  pump();
}

export type EnqueueResult = {
  queued: number;
  /** Photos that could not be read, or are larger than the upload limit. */
  unreadable: number;
  /** Photos already waiting in this album's queue. */
  alreadyQueued: number;
};

/**
 * Copies the picked photos into the app and queues them. Uploading starts with
 * the first photo while the rest are still being copied.
 */
export async function enqueueUploads(
  albumId: string,
  assets: ImagePickerAsset[],
  options: UploadOptions,
  onPrepared?: (prepared: number, total: number) => void
): Promise<EnqueueResult> {
  hydrate();

  const owner = ownerId;
  const generation = ownerGeneration;
  const result: EnqueueResult = { queued: 0, unreadable: 0, alreadyQueued: 0 };
  if (!owner) return result;

  // A new batch starts a new summary for this album.
  const albumIsIdle = !items.some(
    (item) =>
      item.albumId === albumId &&
      (item.status === 'queued' || item.status === 'uploading' || item.status === 'finishing')
  );
  if (albumIsIdle) clearFinishedUploads(albumId);

  for (const [index, asset] of assets.entries()) {
    if (ownerId !== owner || ownerGeneration !== generation) break;
    const prepared = await prepareAsset(asset);

    // A sign-out or A → B → A switch while copying invalidates the whole batch.
    if (ownerId !== owner || ownerGeneration !== generation) {
      if (prepared) deleteLocalFile(prepared.localName);
      break;
    }

    if (!prepared) {
      result.unreadable += 1;
    } else if (
      items.some(
        (item) =>
          item.albumId === albumId &&
          item.ownerId === owner &&
          item.fileHash === prepared.fileHash &&
          item.status !== 'failed' &&
          item.status !== 'done' &&
          item.status !== 'duplicate'
      )
    ) {
      deleteLocalFile(prepared.localName);
      result.alreadyQueued += 1;
    } else {
      setItems([
        ...items,
        {
          ...prepared,
          ...options,
          id: randomUUID(),
          ownerId: owner,
          albumId,
          status: 'queued',
          progress: 0,
          attempts: 0,
          failure: null,
          registering: false,
          staged: null,
          createdAt: Date.now(),
        },
      ]);
      result.queued += 1;
      // The copied photo must be journaled before any network request starts.
      if (persistNow()) pump();
      else patch(items[items.length - 1].id, { status: 'failed', failure: 'server' });
    }

    onPrepared?.(index + 1, assets.length);
  }

  return result;
}

/** Puts a failed upload back in line with a clean slate. */
export function retryUpload(id: string) {
  const item = find(id);
  if (!item || item.ownerId !== ownerId || item.status !== 'failed' || item.failure === 'file-missing') return;

  notBefore.delete(id);
  patch(id, { status: 'queued', progress: 0, attempts: 0, failure: null });
  pump();
}

export function retryFailedUploads(albumId?: string) {
  for (const item of items) {
    // Bulk UI retries must not re-run a legacy Supabase journal held for review.
    if (item.status === 'failed' && !item.staged && (!albumId || item.albumId === albumId)) {
      retryUpload(item.id);
    }
  }
}

/** Cancels an upload (running or not) and forgets it. */
export function removeUpload(id: string) {
  const item = find(id);
  if (!item || item.ownerId !== ownerId) return;

  const controller = running.get(id);
  if (controller) discarded.set(id, item);
  setItems(items.filter((other) => other.id !== id));
  persistNow();
  notBefore.delete(id);
  // The transport releases the server-side reservation when it is aborted.
  controller?.abort();
  if (!controller) {
    transport.discard?.(item);
    deleteLocalFile(item.localName);
  }
}

export function clearFinishedUploads(albumId?: string) {
  const next = items.filter(
    (item) =>
      !(
        (item.status === 'done' || item.status === 'duplicate') &&
        (!albumId || item.albumId === albumId)
      )
  );

  if (next.length !== items.length) setItems(next);
}

export function subscribeToUploads(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The current owner's queue, oldest first. The array is replaced on change. */
export function getUploads() {
  return visibleItems;
}

AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    resumeUploads();
  } else if (persistTimer) {
    // Going to the background: save now rather than on a timer that may not fire.
    clearTimeout(persistTimer);
    persistNow();
  }
});
