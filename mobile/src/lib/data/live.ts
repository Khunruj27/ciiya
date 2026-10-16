import { SITE_URL } from '@/lib/config';
import { albumEditReleaseEnabled } from '@/lib/album-edit-release';
import { albumAccessReleaseEnabled } from '@/lib/album-access-release';
import { photoRetryReleaseEnabled } from '@/lib/photo-retry-release';
import { presetReleaseEnabled } from '@/lib/preset-release';
import { photoDeleteReleaseEnabled } from '@/lib/photo-delete-release';
import { photoReprocessReleaseEnabled } from '@/lib/photo-reprocess-release';
import { supabase } from '@/lib/supabase';

import {
  DataError,
  captureAlbumAccessContext,
  type Album,
  type AlbumPreset,
  type AlbumAccessContext,
  type AlbumAccessInput,
  type AlbumAccessSettings,
  type AlbumDetailsInput,
  type AlbumSettingsInput,
  type CreateAlbumInput,
  type DataSource,
  type Photo,
  type PhotoDeleteOutcome,
  type PhotoPage,
  type PhotoReprocessOutcome,
  type PhotoRetryOutcome,
  type StorageUsage,
} from './types';

/**
 * Calls a Ciiya web API route as the signed-in photographer. The route
 * verifies the access token and applies the same rules as the website, so the
 * app never re-implements (or bypasses) server-side logic.
 */
async function api<T>(
  path: string,
  init: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: unknown;
    signal?: AbortSignal;
    /** Only the bounded access editor interprets a revision mismatch as conflict. */
    accessConflict?: boolean;
    /** Only access calls bind token acquisition/publication to a captured owner. */
    accessContext?: AlbumAccessContext;
    /** Return a 409 body to the caller instead of a generic server error. */
    readConflictBody?: boolean;
    /** Resolve a 404 as null (the target is already gone) instead of failing. */
    notFoundAsNull?: boolean;
  } = {}
): Promise<T> {
  if (init.signal?.aborted) throw new DataError('network');
  if (init.accessContext && !init.accessContext.isCurrent()) throw new DataError('unauthenticated');

  // One deadline includes token refresh, the response and its body. Aborting
  // alone is not enough: some native transports may not settle promptly.
  const controller = new AbortController();
  let rejectDeadline: (error: DataError) => void = () => {};
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject;
    timeout = setTimeout(() => {
      controller.abort();
      reject(new DataError('network'));
    }, 30_000);
  });
  const bounded = <V>(pending: Promise<V>) => Promise.race([pending, deadline]);
  const cancel = () => {
    controller.abort();
    rejectDeadline(new DataError('network'));
  };
  init.signal?.addEventListener('abort', cancel, { once: true });

  try {
    if (init.accessContext && !init.accessContext.isCurrent()) throw new DataError('unauthenticated');
    // getSession() refreshes tokens. Both a returned error and a rejected
    // promise must become a typed data error, never an unhandled auth error.
    let session;
    try {
      session = await bounded(supabase.auth.getSession());
    } catch (error) {
      if (
        error instanceof Error &&
        error.name.startsWith('Auth') &&
        error.name !== 'AuthRetryableFetchError'
      ) {
        throw new DataError('unauthenticated');
      }
      throw new DataError('network');
    }
    if (session.error) {
      throw new DataError(
        session.error.name === 'AuthRetryableFetchError' || session.error.status === 0
          ? 'network'
          : 'unauthenticated'
      );
    }
    if (init.accessContext && (session.data.session?.user?.id !== init.accessContext.expectedOwnerId ||
        !init.accessContext.isCurrent())) throw new DataError('unauthenticated');
    const accessToken = session.data.session?.access_token;
    if (!accessToken) throw new DataError('unauthenticated');
    if (controller.signal.aborted) throw new DataError('network');

    let body: string | undefined;
    try {
      body = init.body === undefined ? undefined : JSON.stringify(init.body);
    } catch {
      throw new DataError('server');
    }

    // Body serialization may invoke a caller's toJSON; recheck immediately at
    // the transport boundary rather than trusting a pre-refresh screen guard.
    if (init.accessContext && !init.accessContext.isCurrent()) throw new DataError('unauthenticated');
    let response: Response;
    try {
      // Deliberately one attempt, especially for create/settings/delete calls:
      // a missing acknowledgement does not mean the mutation was not accepted.
      response = await bounded(fetch(`${SITE_URL}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body,
        signal: controller.signal,
      }));
    } catch {
      throw new DataError('network');
    }
    if (init.accessContext && !init.accessContext.isCurrent()) {
      controller.abort();
      throw new DataError('unauthenticated');
    }

    if (response.status === 404 && init.notFoundAsNull === true) {
      controller.abort();
      return null as T;
    }

    // These statuses are authoritative even if their body never arrives.
    if (response.status === 401 || response.status === 404) {
      controller.abort(); // Do not leave an unread body downloading in the background.
      throw new DataError(response.status === 401 ? 'unauthenticated'
        : (init.method ?? 'GET') === 'GET' ? 'not-found' : 'server');
    }
    if (response.status === 409 && init.accessConflict === true) {
      controller.abort();
      throw new DataError('conflict');
    }

    let payload: (T & { error?: unknown }) | null;
    try {
      payload = await bounded(response.json());
    } catch (error) {
      // Bad JSON is a server response problem; interrupted reading is network.
      if (error instanceof SyntaxError) throw new DataError('server');
      throw new DataError('network');
    }
    if (init.accessContext && !init.accessContext.isCurrent()) {
      controller.abort();
      throw new DataError('unauthenticated');
    }

    if (response.status === 409 && init.readConflictBody === true && payload !== null) {
      return payload;
    }

    if (!response.ok || payload === null) {
      const message = typeof payload?.error === 'string' ? payload.error : undefined;
      throw new DataError('server', message);
    }

    return payload;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    init.signal?.removeEventListener('abort', cancel);
  }
}

function readAlbumAccess(payload: unknown, albumId: string): AlbumAccessSettings {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      Object.keys(payload).length !== 1 || !Object.hasOwn(payload, 'settings')) {
    throw new DataError('server');
  }
  const settings = (payload as { settings: unknown }).settings;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new DataError('server');
  }
  const value = settings as Record<string, unknown>;
  const fields = ['albumId', 'allowDownload', 'downloadSize', 'isPasswordProtected', 'revision'];
  if (Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field)) ||
      typeof value.albumId !== 'string' || !value.albumId || value.albumId !== albumId ||
      typeof value.allowDownload !== 'boolean' || typeof value.isPasswordProtected !== 'boolean' ||
      typeof value.downloadSize !== 'string' || !['sd', 'hd', 'uhd', 'original'].includes(value.downloadSize) ||
      typeof value.revision !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.revision)) {
    throw new DataError('server');
  }
  // Copy the exact safe contract rather than exposing an arbitrary server object.
  return {
    albumId: value.albumId,
    allowDownload: value.allowDownload,
    downloadSize: value.downloadSize as AlbumAccessSettings['downloadSize'],
    isPasswordProtected: value.isPasswordProtected,
    revision: value.revision,
  };
}

/** Copies exactly the safe preset contract; anything else is a server error. */
function readAlbumPreset(value: unknown): AlbumPreset {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DataError('server');
  const preset = value as Record<string, unknown>;
  if (typeof preset.path !== 'string' || !/^[A-Za-z0-9/._-]{1,500}\.xmp$/i.test(preset.path) ||
      preset.path.includes('..') || typeof preset.name !== 'string' || !preset.name ||
      (preset.createdAt !== null && typeof preset.createdAt !== 'string')) {
    throw new DataError('server');
  }
  return { path: preset.path, name: preset.name.slice(0, 120), createdAt: preset.createdAt ?? null };
}

function validAlbumAccessInput(input: AlbumAccessInput): boolean {
  if (!input || typeof input.albumId !== 'string' || !input.albumId ||
      typeof input.allowDownload !== 'boolean' || typeof input.isPasswordProtected !== 'boolean' ||
      typeof input.downloadSize !== 'string' || !['sd', 'hd', 'uhd', 'original'].includes(input.downloadSize) ||
      typeof input.revision !== 'string' || !/^[a-f0-9]{64}$/.test(input.revision) ||
      typeof input.password !== 'string') return false;
  let length = 0;
  for (const character of input.password) {
    const codePoint = character.codePointAt(0)!;
    length += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (length > 72) return false;
  }
  return true;
}

export const liveData: DataSource = {
  async fetchAlbums() {
    const { albums } = await api<{ albums: Album[] }>('/api/mobile/albums');
    return albums;
  },

  async fetchAlbum(albumId) {
    const { album } = await api<{ album: Album }>(
      `/api/mobile/albums/${encodeURIComponent(albumId)}`
    );
    return album;
  },

  async fetchPhotos(albumId, cursor) {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return api<PhotoPage>(
      `/api/mobile/albums/${encodeURIComponent(albumId)}/photos${query}`
    );
  },

  async fetchPhotoUpdates(albumId, ids): Promise<Photo[]> {
    if (ids.length === 0) return [];
    // The feed rotates at most 120 pending IDs per tick, including older pages.
    // Do not silently truncate: that would leave the omitted photos stale.
    if (ids.length > 120) throw new DataError('server', 'Too many photo updates');
    const { photos } = await api<PhotoPage>(
      `/api/mobile/albums/${encodeURIComponent(albumId)}/photos?ids=${encodeURIComponent(ids.join(','))}`
    );
    return photos;
  },

  // A plain read of the photographer's own row; row level security scopes it.
  async fetchStorageUsage(expectedOwnerId?: string): Promise<StorageUsage> {
    let session;
    try {
      session = await supabase.auth.getSession();
    } catch (error) {
      throw new DataError(
        error instanceof Error && error.name.startsWith('Auth') &&
        error.name !== 'AuthRetryableFetchError' ? 'unauthenticated' : 'network'
      );
    }
    if (session.error) {
      throw new DataError(
        session.error.name === 'AuthRetryableFetchError' || session.error.status === 0
          ? 'network' : 'unauthenticated'
      );
    }
    const userId = session.data.session?.user.id;

    if (!userId || (expectedOwnerId !== undefined && userId !== expectedOwnerId)) {
      throw new DataError('unauthenticated');
    }

    const { data, error, status } = await supabase
      .from('user_storage_usage')
      .select('current_plan, storage_used_bytes, used_bytes, storage_limit_bytes')
      .eq('user_id', userId)
      .maybeSingle();

    if (status === 401) throw new DataError('unauthenticated');
    if (error) throw new DataError('server', error.message);
    if (!data) throw new DataError('not-found');

    // Missing/invalid rows must not invent a Free plan or zero used bytes.
    const bytes = (value: unknown): number => {
      if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(\.\d+)?$/.test(value.trim()))) {
        throw new DataError('server');
      }
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > Number.MAX_SAFE_INTEGER) {
        throw new DataError('server');
      }
      return parsed;
    };
    if (typeof data.current_plan !== 'string' || !data.current_plan.trim() || data.current_plan.length > 64) {
      throw new DataError('server');
    }

    return {
      plan: data.current_plan.trim(),
      usedBytes: bytes(data.storage_used_bytes ?? data.used_bytes),
      // Zero/absent capacity is unknown, never a claim of unlimited storage.
      limitBytes: data.storage_limit_bytes == null ? 0 : bytes(data.storage_limit_bytes),
    };
  },

  async createAlbum(input: CreateAlbumInput) {
    const { album } = await api<{ album: { id: string } }>('/api/albums/create', {
      method: 'POST',
      body: { title: input.title, description: input.description },
    });

    if (!album || typeof album.id !== 'string' || !album.id.trim()) {
      throw new DataError('server');
    }
    // The write is already acknowledged. A failed follow-up GET must not make
    // the form offer to create a second album; the destination can retry reads.
    return { id: album.id };
  },

  async updateAlbumDetails(input: AlbumDetailsInput) {
    // Independent of demo/UI state: no token read or request before release.
    if (!albumEditReleaseEnabled) throw new DataError('server');
    const result = await api<{ success: boolean }>(
      `/api/mobile/albums/${encodeURIComponent(input.albumId)}/details`, {
        method: 'PATCH',
        body: { title: input.title, description: input.description },
      });
    if (result.success !== true) throw new DataError('server');
  },

  async fetchAlbumAccess(albumId, context) {
    if (!albumAccessReleaseEnabled) throw new DataError('server');
    const accessContext = captureAlbumAccessContext(context);
    if (typeof albumId !== 'string' || !albumId) throw new DataError('server');
    const result = await api<unknown>(`/api/mobile/albums/${encodeURIComponent(albumId)}/access`, { accessContext });
    if (!accessContext.isCurrent()) throw new DataError('unauthenticated');
    const settings = readAlbumAccess(result, albumId);
    if (!accessContext.isCurrent()) throw new DataError('unauthenticated');
    return settings;
  },

  async updateAlbumAccess(input: AlbumAccessInput, context) {
    if (!albumAccessReleaseEnabled) throw new DataError('server');
    const accessContext = captureAlbumAccessContext(context);
    if (!validAlbumAccessInput(input)) throw new DataError('server');
    const result = await api<{ success: boolean }>(
      `/api/mobile/albums/${encodeURIComponent(input.albumId)}/access`, {
        method: 'PATCH',
        accessConflict: true,
        accessContext,
        body: {
          allowDownload: input.allowDownload,
          downloadSize: input.downloadSize,
          isPasswordProtected: input.isPasswordProtected,
          password: input.password,
          revision: input.revision,
        },
      });
    if (!accessContext.isCurrent()) throw new DataError('unauthenticated');
    if (!result || typeof result !== 'object' || result.success !== true) throw new DataError('server');
    if (!accessContext.isCurrent()) throw new DataError('unauthenticated');
  },

  async updateAlbumSettings(_input: AlbumSettingsInput) {
    // Native callers cannot write passwords/download settings through the
    // website's legacy full-settings route, even after metadata is released.
    throw new DataError('server');
  },

  async deleteAlbum(_albumId) {
    // This stage never enables deletion, including direct legacy callers.
    throw new DataError('server');
  },

  async retryPhotoProcessing(albumId, photoId): Promise<PhotoRetryOutcome> {
    // Independent of demo/UI state: no token read or request before release.
    if (!photoRetryReleaseEnabled) throw new DataError('server');
    if (typeof albumId !== 'string' || !albumId || typeof photoId !== 'string' || !photoId) {
      throw new DataError('server');
    }
    const result = await api<Record<string, unknown>>(
      `/api/mobile/albums/${encodeURIComponent(albumId)}/photos/${encodeURIComponent(photoId)}/retry`, {
        method: 'POST',
        body: {},
        readConflictBody: true,
      });
    if (!result || typeof result !== 'object') throw new DataError('server');
    if (result.success === true) {
      if (result.retried === true) return 'queued';
      if (result.retried === false) return 'already-queued';
      throw new DataError('server');
    }
    if (result.code === 'SOURCE_MISSING') return 'source-missing';
    if (result.code === 'NOT_RETRYABLE') return 'not-retryable';
    // A lost compare-and-set race: the caller refreshes and decides again.
    if (result.code === 'RETRY_CONFLICT') throw new DataError('conflict');
    throw new DataError('server');
  },

  async reprocessPhoto(albumId, photoId): Promise<PhotoReprocessOutcome> {
    // Independent of demo/UI state: no token read or request before release.
    if (!photoReprocessReleaseEnabled) throw new DataError('server');
    if (typeof albumId !== 'string' || !albumId || typeof photoId !== 'string' || !photoId) {
      throw new DataError('server');
    }
    const result = await api<Record<string, unknown>>(
      `/api/mobile/albums/${encodeURIComponent(albumId)}/photos/${encodeURIComponent(photoId)}/reprocess`, {
        method: 'POST',
        body: {},
        readConflictBody: true,
      });
    if (!result || typeof result !== 'object') throw new DataError('server');
    if (result.success === true) {
      if (result.queued === true) return 'queued';
      if (result.queued === false) return 'already-queued';
      throw new DataError('server');
    }
    if (result.code === 'SOURCE_MISSING') return 'source-missing';
    if (result.code === 'NOT_REPROCESSABLE') return 'not-reprocessable';
    if (result.code === 'RETRY_CONFLICT') throw new DataError('conflict');
    throw new DataError('server');
  },

  async deletePhoto(albumId, photoId): Promise<PhotoDeleteOutcome> {
    // Independent of demo/UI state: no token read or request before release.
    if (!photoDeleteReleaseEnabled) throw new DataError('server');
    if (typeof albumId !== 'string' || !albumId || typeof photoId !== 'string' || !photoId) {
      throw new DataError('server');
    }
    // One attempt only: a lost reply may still have deleted the photo, and a
    // later request then answers 404, which is reported as already gone.
    const result = await api<Record<string, unknown> | null>(
      `/api/mobile/albums/${encodeURIComponent(albumId)}/photos/${encodeURIComponent(photoId)}`, {
        method: 'DELETE',
        readConflictBody: true,
        notFoundAsNull: true,
      });
    if (result === null) return 'gone';
    if (result.success === true) return 'deleted';
    if (result.code === 'PHOTO_PROCESSING') return 'processing';
    throw new DataError('server');
  },

  async fetchAlbumPresets(albumId) {
    // Independent of demo/UI state: no token read or request before release.
    if (!presetReleaseEnabled) throw new DataError('server');
    if (typeof albumId !== 'string' || !albumId) throw new DataError('server');
    const result = await api<{ presets?: unknown }>(`/api/mobile/albums/${encodeURIComponent(albumId)}/presets`);
    if (!result || !Array.isArray(result.presets) || result.presets.length > 100) throw new DataError('server');
    return result.presets.map(readAlbumPreset);
  },

  async uploadAlbumPreset(albumId, input) {
    if (!presetReleaseEnabled) throw new DataError('server');
    if (typeof albumId !== 'string' || !albumId || !input ||
        typeof input.fileName !== 'string' || typeof input.content !== 'string') {
      throw new DataError('server');
    }
    // One attempt only: a lost reply may still have stored the preset.
    const result = await api<{ preset?: unknown }>(`/api/mobile/albums/${encodeURIComponent(albumId)}/presets`, {
      method: 'POST',
      body: { fileName: input.fileName, content: input.content },
    });
    return readAlbumPreset(result?.preset);
  },

  async setAlbumCover(albumId, photoId) {
    if (!albumEditReleaseEnabled) throw new DataError('server');
    const result = await api<{ success: boolean }>(
      `/api/mobile/albums/${encodeURIComponent(albumId)}/cover`, {
        method: 'PATCH',
        body: { photoId },
      });
    if (result.success !== true) throw new DataError('server');
  },
};
