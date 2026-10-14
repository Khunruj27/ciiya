import type { File } from 'expo-file-system';

import { SITE_URL } from '@/lib/config';
import { supabase } from '@/lib/supabase';
import { createBoundedFetch, SUPABASE_REQUEST_TIMEOUT_MS } from '@/lib/bounded-fetch';

import { localFile } from './files';
import { UploadError, type UploadItem, type UploadTransport } from './types';

/**
 * Native uploads use R2 only: reserve a signed upload, send the bytes straight
 * to R2, then ask the server to register the photo. Every step is safe to
 * repeat, so a retry after a dropped connection never creates a second photo.
 * Legacy Supabase journals are held untouched; they cannot authorize sending,
 * re-registering or deleting an object through this transport.
 */

type Json = Record<string, unknown>;

type Reservation = {
  uploadSessionId: string;
  uploadUrl: string;
  headers: Record<string, string>;
  storagePath: string;
  bucket: string;
  fileHash: string;
};

const fetchJson = createBoundedFetch((input, init) => fetch(input, init));

function cancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new UploadError('network');
}

/** Bound auth + JSON work together, never the separate native photo transfer. */
async function boundedOperation<T>(work: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
  cancelled(signal);
  const controller = new AbortController();
  let rejectDeadline: (error: UploadError) => void = () => {};
  const deadline = new Promise<never>((_resolve, reject) => { rejectDeadline = reject; });
  void deadline.catch(() => {});
  const stop = () => {
    rejectDeadline(new UploadError('network', { retryable: !signal?.aborted }));
    controller.abort();
  };
  const timer = setTimeout(stop, SUPABASE_REQUEST_TIMEOUT_MS);
  signal?.addEventListener('abort', stop, { once: true });
  try {
    return await Promise.race([work(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}

/** A transport/auth-server outage must not put the queue behind its sign-in gate. */
function authError(error: unknown): UploadError {
  const info = error as { name?: unknown; status?: unknown } | null;
  if (info?.name === 'AuthSessionMissingError' || info?.name === 'AuthInvalidTokenResponseError' ||
    info?.name === 'AuthInvalidJwtError' ||
    (info?.name === 'AuthApiError' && (info.status === 400 || info.status === 401 || info.status === 403))) {
    return new UploadError('session', { signedOut: true });
  }
  // Includes AuthRetryableFetchError, AbortError, 429/5xx and rejected network
  // promises. Do not copy raw errors that may contain credentials or URLs.
  return new UploadError('network', { retryable: true });
}

async function accessToken(expectedOwnerId: string, signal?: AbortSignal) {
  return boundedOperation(async (currentSignal) => {
    // getSession() refreshes an expired token before handing it back. It does
    // not take AbortSignal, so a late result must never start an upload.
    const result = await supabase.auth.getSession().catch((error: unknown) => { throw authError(error); });
    cancelled(currentSignal);
    if (result.error) throw authError(result.error);
    const session = result.data.session;
    if (!session?.access_token || session.user.id !== expectedOwnerId) {
      throw new UploadError('session', { signedOut: true });
    }
    return { token: session.access_token, userId: session.user.id };
  }, signal);
}

async function callApi(
  path: string,
  method: 'POST',
  body: Json,
  ownerId: string,
  signal?: AbortSignal
): Promise<{ status: number; data: Json | null }> {
  return boundedOperation(async (currentSignal) => {
    async function send(token: string) {
      try {
        cancelled(currentSignal);
        return await fetchJson(`${SITE_URL}${path}`, {
          method,
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: currentSignal,
        });
      } catch {
        throw new UploadError('network', { retryable: !currentSignal.aborted });
      }
    }

    const { token } = await accessToken(ownerId, currentSignal);
    let response = await send(token);
    cancelled(currentSignal);

    if (response.status === 401) {
      // Only an authoritative 401 permits one resend; timeout/missing ACK never
      // triggers a second mutation inside this attempt.
      const refreshed = await supabase.auth.refreshSession().catch((error: unknown) => { throw authError(error); });
      cancelled(currentSignal);
      if (refreshed.error) throw authError(refreshed.error);
      const refreshedSession = refreshed.data?.session;
      if (!refreshedSession?.access_token || refreshedSession.user.id !== ownerId) {
        throw new UploadError('session', { signedOut: true });
      }
      if (refreshedSession.access_token !== token) response = await send(refreshedSession.access_token);
    }

    // fetchJson has already bounded/drained the body. A malformed success is a
    // non-retryable server failure, not permission to repeat a mutation or clean
    // up an uncertain original. Authoritative HTTP refusals retain their policy.
    let data: Json | null = null;
    try {
      const payload: unknown = await response.json();
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        data = payload as Json;
      } else if (response.status >= 200 && response.status < 300) {
        throw new UploadError('server');
      }
    } catch (error) {
      if (error instanceof UploadError) throw error;
      if (!(error instanceof SyntaxError)) {
        throw new UploadError('network', { retryable: !currentSignal.aborted });
      }
      if (response.status >= 200 && response.status < 300) throw new UploadError('server');
    }
    cancelled(currentSignal);
    return { status: response.status, data };
  }, signal);
}

/** Maps a refused API call to what the queue should do about it. */
function apiError(status: number, data: Json | null): UploadError {
  const code = typeof data?.code === 'string' ? data.code : '';
  const message = typeof data?.error === 'string' ? data.error : undefined;

  // Rollout availability is a deliberate server policy, not a transient error
  // or permission to use a different storage provider. A manual retry remains
  // possible after an operator has separately resolved the policy.
  if (code === 'R2_UPLOADS_DISABLED') return new UploadError('server');
  if (status === 401) return new UploadError('session', { message });
  if (code === 'STORAGE_LIMIT_EXCEEDED') return new UploadError('storage-full', { message });
  if (status === 404) return new UploadError('album-missing', { message });
  if (status === 400 || status === 413) return new UploadError('rejected', { message });

  // 409/410 mean the reservation was lost or expired: starting the attempt
  // again reserves a fresh one. Throttling and server faults pass with time.
  return new UploadError('server', { retryable: true, message });
}

async function sendFile(
  file: File,
  url: string,
  options: {
    method: 'PUT' | 'POST';
    headers: Record<string, string>;
    onProgress: (progress: number) => void;
    signal: AbortSignal;
  }
) {
  try {
    if (options.signal.aborted) throw new Error('Upload cancelled');
    return await file.upload(url, {
      httpMethod: options.method,
      headers: options.headers,
      signal: options.signal,
      onProgress: ({ bytesSent, totalBytes }) => {
        if (totalBytes > 0) options.onProgress(Math.min(1, bytesSent / totalBytes));
      },
    });
  } catch (error) {
    if (options.signal.aborted) throw error;
    if (!file.exists) throw new UploadError('file-missing');
    throw new UploadError('network', { retryable: true });
  }
}

function finalizeBody(item: UploadItem, extra: Json): Json {
  return {
    albumId: item.albumId,
    fileName: item.fileName,
    fileSizeBytes: item.sizeBytes,
    size: item.size,
    categoryId: null,
    presetPath: null,
    autoFaceScan: item.autoFaceScan,
    autoPublish: item.autoPublish,
    ...extra,
  };
}

export const liveTransport: UploadTransport = {
  async upload(item, hooks) {
    // Old staged entries may already be accepted originals. Hold their complete
    // journal without reading a session, sending a request or touching a file.
    // Neither an automatic nor a manual retry may reinterpret them as R2 work.
    if (item.staged) throw new UploadError('server');

    const file = localFile(item.localName);
    if (!file.exists) throw new UploadError('file-missing');

    const reserved = await callApi(
      '/api/photos/upload-url',
      'POST',
      {
        albumId: item.albumId,
        clientUploadId: item.id,
        fileName: item.fileName,
        contentType: item.mimeType,
        fileSizeBytes: item.sizeBytes,
        fileHash: item.fileHash,
        size: item.size,
        categoryId: null,
        presetPath: null,
        autoFaceScan: item.autoFaceScan,
        autoPublish: item.autoPublish,
      },
      item.ownerId,
      hooks.signal
    );

    if (reserved.data?.code === 'R2_UPLOADS_DISABLED') {
      throw apiError(reserved.status, reserved.data);
    }

    // The album already has this photo — including the case where an earlier
    // attempt finished on the server but its answer never reached the phone.
    if (reserved.status >= 200 && reserved.status < 300 &&
      reserved.data?.success === true && reserved.data.duplicate === true) return 'duplicate';

    if (reserved.status < 200 || reserved.status >= 300 || reserved.data?.success !== true) {
      throw apiError(reserved.status, reserved.data);
    }

    const reservation = reserved.data as unknown as Partial<Reservation>;
    const { uploadSessionId, uploadUrl, headers, storagePath, bucket, fileHash } = reservation;

    if (!uploadSessionId || !uploadUrl || !headers || !storagePath || !bucket || !fileHash) {
      throw new UploadError('server', { retryable: true });
    }

    const sent = await sendFile(file, uploadUrl, {
      method: 'PUT',
      headers,
      onProgress: hooks.onProgress,
      signal: hooks.signal,
    });

    // 412 is the signed URL's "already there" answer: an earlier attempt
    // stored these exact bytes, so there is nothing left to send.
    if ((sent.status < 200 || sent.status >= 300) && sent.status !== 412) {
      throw new UploadError('server', { retryable: true });
    }

    hooks.onFinishing();

    const finalized = await callApi(
      '/api/photos/finalize-upload',
      'POST',
      finalizeBody(item, {
        storagePath,
        storageProvider: 'r2',
        storageBucket: bucket,
        uploadSessionId,
        fileHash,
      }),
      item.ownerId,
      hooks.signal
    );

    // Native clients never cancel reservations or delete remote bytes, even
    // for a duplicate, a refused transfer or a cleanupSafe response. Finalizing
    // may already have adopted these bytes as an original or repair source.
    // Existing server audit/expiry policy owns any eventual reconciliation.
    if (finalized.data?.code === 'R2_UPLOADS_DISABLED') {
      throw apiError(finalized.status, finalized.data);
    }
    if (finalized.status >= 200 && finalized.status < 300 &&
      finalized.data?.success === true && finalized.data.duplicate === true) return 'duplicate';

    if (finalized.status < 200 || finalized.status >= 300 || finalized.data?.success !== true) {
      throw apiError(finalized.status, finalized.data);
    }

    return 'done';
  },

  discard() {
    // Removing a queue item cannot authorize remote object deletion. Legacy
    // Supabase originals are never touched; R2 reservations expire server-side.
  },
};
