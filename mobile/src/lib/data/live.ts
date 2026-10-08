import { SITE_URL } from '@/lib/config';
import { supabase } from '@/lib/supabase';

import {
  DataError,
  type Album,
  type AlbumSettingsInput,
  type CreateAlbumInput,
  type DataSource,
  type PhotoPage,
  type StorageUsage,
} from './types';

/**
 * Calls a Ciiya web API route as the signed-in photographer. The route
 * verifies the access token and applies the same rules as the website, so the
 * app never re-implements (or bypasses) server-side logic.
 */
async function api<T>(
  path: string,
  init: { method?: 'GET' | 'POST' | 'PATCH'; body?: unknown } = {}
): Promise<T> {
  // getSession() hands back a fresh token, refreshing it first when needed.
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  if (!accessToken) throw new DataError('unauthenticated');

  let response: Response;

  try {
    response = await fetch(`${SITE_URL}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new DataError('network');
  }

  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;

  if (!response.ok || payload === null) {
    const message = payload?.error;
    if (response.status === 401) throw new DataError('unauthenticated', message);
    if (response.status === 404) throw new DataError('not-found', message);
    throw new DataError('server', message);
  }

  return payload;
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

  // A plain read of the photographer's own row; row level security scopes it.
  async fetchStorageUsage(): Promise<StorageUsage> {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id;

    if (!userId) throw new DataError('unauthenticated');

    const { data, error } = await supabase
      .from('user_storage_usage')
      .select('current_plan, storage_used_bytes, used_bytes, storage_limit_bytes')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw new DataError('server', error.message);

    return {
      plan: String(data?.current_plan || 'free'),
      usedBytes: Number(data?.storage_used_bytes ?? data?.used_bytes ?? 0) || 0,
      limitBytes: Number(data?.storage_limit_bytes ?? 0) || 0,
    };
  },

  async createAlbum(input: CreateAlbumInput) {
    const { album } = await api<{ album: { id: string } }>('/api/albums/create', {
      method: 'POST',
      body: { title: input.title, description: input.description },
    });

    // The create route answers with the raw row; read it back in app shape.
    return liveData.fetchAlbum(album.id);
  },

  async updateAlbumSettings(input: AlbumSettingsInput) {
    await api<{ success: boolean }>('/api/albums/settings', {
      method: 'PATCH',
      body: input,
    });
  },

  async deleteAlbum(albumId) {
    await api<{ success: boolean }>('/api/albums/delete', {
      method: 'POST',
      body: { albumId },
    });
  },

  async setAlbumCover(albumId, photoId) {
    await api<{ success: boolean }>('/api/albums/cover', {
      method: 'PATCH',
      body: { albumId, photoId },
    });
  },
};
