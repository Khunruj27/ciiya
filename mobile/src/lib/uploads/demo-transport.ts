import { addDemoUploadedPhoto } from '@/lib/data/demo';

import { localFile } from './files';
import { UploadError, type UploadItem, type UploadTransport } from './types';

/**
 * Development-only stand-in for the network (see `isDemoMode`): real files are
 * picked and queued, but the "upload" is a timer. Every third photo drops its
 * connection once, so the automatic retry can be seen working.
 */

const STEPS = 12;
const STEP_MS = 140;

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'));
      return;
    }

    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      reject(new Error('aborted'));
    }

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

let started = 0;
const sentHashes = new Map<string, Set<string>>();

export const demoTransport: UploadTransport = {
  async upload(item: UploadItem, hooks) {
    if (!localFile(item.localName).exists) throw new UploadError('file-missing');

    const albumHashes = sentHashes.get(item.albumId) ?? new Set<string>();
    sentHashes.set(item.albumId, albumHashes);
    if (albumHashes.has(item.fileHash)) return 'duplicate';

    started += 1;
    const dropsOnce = started % 3 === 0 && item.attempts === 0;

    for (let step = 1; step <= STEPS; step += 1) {
      await wait(STEP_MS, hooks.signal);
      hooks.onProgress(step / STEPS);

      if (dropsOnce && step === Math.floor(STEPS / 2)) {
        throw new UploadError('network', { retryable: true });
      }
    }

    hooks.onFinishing();
    await wait(300, hooks.signal);

    albumHashes.add(item.fileHash);
    addDemoUploadedPhoto(item.albumId, item.fileName);
    return 'done';
  },
};
