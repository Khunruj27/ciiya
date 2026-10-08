import { randomUUID } from 'expo-crypto';
import type { File } from 'expo-file-system';

import { SITE_URL } from '@/lib/config';
import { supabase } from '@/lib/supabase';

import { localFile } from './files';
import { UploadError, type UploadItem, type UploadTransport } from './types';

/**
 * Sends a queued photo through the same server flow as the website's uploader:
 * reserve a signed upload, send the bytes straight to storage, then ask the
 * server to register the photo. Every step is safe to repeat, so a retry after
 * a dropped connection never creates a second photo.
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

async function accessToken() {
  // getSession() refreshes an expired token before handing it back.
  const { data } = await supabase.auth.getSession();
  const session = data.session;

  if (!session) throw new UploadError('server', { signedOut: true });
  return { token: session.access_token, userId: session.user.id };
}

async function callApi(
  path: string,
  method: 'POST' | 'DELETE',
  body: Json,
  signal?: AbortSignal
): Promise<{ status: number; data: Json | null }> {
  async function send(token: string) {
    try {
      return await fetch(`${SITE_URL}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new UploadError('network', { retryable: true });
    }
  }

  const { token } = await accessToken();
  let response = await send(token);

  if (response.status === 401) {
    // The token may have expired a moment ago; ask for a new one and try once more.
    const { data: refreshed } = await supabase.auth.refreshSession().catch(() => ({ data: null }));
    const fresh = refreshed?.session?.access_token;
    if (fresh && fresh !== token) response = await send(fresh);
  }

  const data = (await response.json().catch(() => null)) as Json | null;
  return { status: response.status, data };
}

/** Maps a refused API call to what the queue should do about it. */
function apiError(status: number, data: Json | null): UploadError {
  const code = typeof data?.code === 'string' ? data.code : '';
  const message = typeof data?.error === 'string' ? data.error : undefined;

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

async function cancelReservation(uploadSessionId: string) {
  try {
    await callApi('/api/photos/upload-url', 'DELETE', { uploadSessionId });
  } catch {
    // The reservation expires on its own; server cleanup removes the object.
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

function removeStoredObject(storagePath: string) {
  return supabase.storage
    .from('albums')
    .remove([storagePath])
    .then(
      () => undefined,
      () => undefined
    );
}

/**
 * Accounts not yet moved to R2 upload into Supabase Storage, as on the web.
 *
 * Unlike the R2 flow, registering the photo here is not safely repeatable: a
 * second request for a photo that was already registered answers "duplicate".
 * So once a registration request has gone out without a clear answer, the
 * stored file is kept and only the registration is tried again — deleting it
 * could remove the original of a photo the server did accept.
 */
async function uploadThroughSupabase(
  item: UploadItem,
  file: File,
  hooks: Parameters<UploadTransport['upload']>[1]
): Promise<'done' | 'duplicate'> {
  let staged = item.staged;

  if (!staged) {
    const supabaseUrl = String(process.env.EXPO_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
    const anonKey = String(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '');
    const { token, userId } = await accessToken();

    const extension = item.fileName.split('.').pop() || 'jpg';
    const storagePath = `${userId}/${item.albumId}/original/${Date.now()}-${randomUUID()}.${extension}`;

    const stored = await sendFile(file, `${supabaseUrl}/storage/v1/object/albums/${storagePath}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
        'Content-Type': item.mimeType,
        'x-upsert': 'false',
      },
      onProgress: hooks.onProgress,
      signal: hooks.signal,
    });

    if (stored.status === 401) throw new UploadError('session');
    if (stored.status === 413) throw new UploadError('rejected');
    if (stored.status < 200 || stored.status >= 300) {
      throw new UploadError('server', { retryable: true });
    }

    staged = { storagePath, uncertain: false };
    hooks.onStaged(staged);
  }

  const { storagePath } = staged;
  hooks.onFinishing();

  let finalized: Awaited<ReturnType<typeof callApi>>;
  try {
    finalized = await callApi(
      '/api/photos/finalize-upload',
      'POST',
      finalizeBody(item, { storagePath, fileHash: item.fileHash }),
      hooks.signal
    );
  } catch (error) {
    // No session means the request was never sent; anything else may have arrived.
    if (!(error instanceof UploadError && error.signedOut)) {
      hooks.onStaged({ storagePath, uncertain: true });
    }
    throw error;
  }

  const { status, data } = finalized;

  if (data?.duplicate === true) {
    hooks.onStaged(null);
    // After an unanswered request, "duplicate" is that request having worked.
    if (staged.uncertain) return 'done';

    await removeStoredObject(storagePath);
    return 'duplicate';
  }

  if (status >= 200 && status < 300 && data?.success === true) {
    hooks.onStaged(null);
    return 'done';
  }

  if (status === 400 || status === 403 || status === 404 || status === 413) {
    // A clear refusal: nothing was registered, so the stored file can go.
    hooks.onStaged(null);
    await removeStoredObject(storagePath);
  } else if (status >= 500) {
    hooks.onStaged({ storagePath, uncertain: true });
  }

  throw apiError(status, data);
}

export const liveTransport: UploadTransport = {
  async upload(item, hooks) {
    const file = localFile(item.localName);
    if (!file.exists) throw new UploadError('file-missing');

    // Already stored in Supabase Storage on an earlier attempt: finish that.
    if (item.staged) return uploadThroughSupabase(item, file, hooks);

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
      hooks.signal
    );

    if (reserved.data?.code === 'R2_UPLOADS_DISABLED') {
      return uploadThroughSupabase(item, file, hooks);
    }

    // The album already has this photo — including the case where an earlier
    // attempt finished on the server but its answer never reached the phone.
    if (reserved.data?.duplicate === true) return 'duplicate';

    if (reserved.status < 200 || reserved.status >= 300 || reserved.data?.success !== true) {
      throw apiError(reserved.status, reserved.data);
    }

    const reservation = reserved.data as unknown as Partial<Reservation>;
    const { uploadSessionId, uploadUrl, headers, storagePath, bucket, fileHash } = reservation;

    if (!uploadSessionId || !uploadUrl || !headers || !storagePath || !bucket || !fileHash) {
      throw new UploadError('server', { retryable: true });
    }

    let stored = false;

    try {
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

      stored = true;
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
        hooks.signal
      );

      if (finalized.data?.duplicate === true) {
        await cancelReservation(uploadSessionId);
        return 'duplicate';
      }

      if (finalized.status < 200 || finalized.status >= 300 || finalized.data?.success !== true) {
        if (finalized.data?.cleanupSafe === true) await cancelReservation(uploadSessionId);
        throw apiError(finalized.status, finalized.data);
      }

      return 'done';
    } catch (error) {
      // Nothing was stored, so release the reserved quota straight away.
      if (!stored) await cancelReservation(uploadSessionId);
      throw error;
    }
  },

  discard(item) {
    // Only when certain the file never became a photo.
    if (item.staged && !item.staged.uncertain) void removeStoredObject(item.staged.storagePath);
  },
};
