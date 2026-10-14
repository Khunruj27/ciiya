import { SITE_URL } from '@/lib/config';

import {
  DataError,
  captureAlbumAccessContext,
  type Album,
  type AlbumAccessSettings,
  type DataSource,
  type Photo,
} from './types';

/**
 * In-memory sample data for the development-only demo mode (see
 * `isDemoMode`). Nothing here touches the network apart from loading the
 * website's own public sample photographs.
 */
const SAMPLE_IMAGES = [
  'editorial-couple',
  'editorial-bride',
  'editorial-details',
  'editorial-reception',
  'editorial-walk',
  'feature-share',
].map((name) => `${SITE_URL}/landing/${name}.webp`);

const PAGE_SIZE = 24;
const delay = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));

function makePhotos(albumId: string, count: number): Photo[] {
  return Array.from({ length: count }, (_, index) => {
    const url = SAMPLE_IMAGES[index % SAMPLE_IMAGES.length];
    return {
      id: `${albumId}-photo-${index + 1}`,
      filename: `CIIYA_${String(index + 1).padStart(4, '0')}.jpg`,
      thumbnailUrl: url,
      previewUrl: url,
      blurDataUrl: null,
      width: null,
      height: null,
      // The newest photo of the first album is shown as still processing.
      isReady: !(albumId === 'demo-1' && index === 0),
      processingStatus: albumId === 'demo-1' && index === 0 ? 'processing' : 'done',
      processingProgress: albumId === 'demo-1' && index === 0 ? 35 : null,
      createdAt: new Date(Date.UTC(2026, 9, 8, 12, 0, 0) - index * 60_000).toISOString(),
    };
  });
}

let albums: Album[] = [
  {
    id: 'demo-1',
    title: 'Air & Pleum — Wedding',
    description: 'พิธีเช้าและงานเลี้ยงฉลอง ณ The Riverside',
    coverUrl: SAMPLE_IMAGES[0],
    createdAt: '2026-10-08T03:00:00.000Z',
    shareToken: 'demo-share-token-1',
    allowDownload: true,
    downloadSize: 'hd',
    isPasswordProtected: false,
    photoCount: 58,
    autoFaceScan: true,
    autoPublish: false,
  },
  {
    id: 'demo-2',
    title: 'Prewedding เขาใหญ่',
    description: null,
    coverUrl: SAMPLE_IMAGES[4],
    createdAt: '2026-09-28T03:00:00.000Z',
    shareToken: 'demo-share-token-2',
    allowDownload: true,
    downloadSize: 'uhd',
    isPasswordProtected: true,
    photoCount: 13,
    autoFaceScan: true,
    autoPublish: false,
  },
  {
    id: 'demo-3',
    title: 'งานรับปริญญา',
    description: null,
    coverUrl: null,
    createdAt: '2026-09-12T03:00:00.000Z',
    shareToken: 'demo-share-token-3',
    allowDownload: false,
    downloadSize: 'hd',
    isPasswordProtected: false,
    photoCount: 0,
    autoFaceScan: true,
    autoPublish: false,
  },
];

const photosByAlbum = new Map<string, Photo[]>(
  albums.map((album) => [album.id, makePhotos(album.id, album.photoCount)])
);

// Demo revisions are opaque in-memory version markers, not credentials or
// password hashes. A local sequence keeps even deterministic fixture runs fresh.
let accessRevisionSequence = 0;
const accessRevisions = new Map<string, string>();
function advanceAccessRevision(albumId: string): string {
  const noise = Array.from({ length: 48 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  const revision = `${noise}${(++accessRevisionSequence).toString(16).padStart(16, '0')}`;
  accessRevisions.set(albumId, revision);
  return revision;
}

function readDemoAccess(album: Album): AlbumAccessSettings {
  return {
    albumId: album.id,
    allowDownload: album.allowDownload,
    downloadSize: album.downloadSize,
    isPasswordProtected: album.isPasswordProtected,
    revision: accessRevisions.get(album.id) ?? advanceAccessRevision(album.id),
  };
}

function passwordUtf8Bytes(value: string): number {
  let length = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    length += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (length > 72) return length;
  }
  return length;
}

function findAlbum(albumId: string) {
  const album = albums.find((item) => item.id === albumId);
  if (!album) throw new DataError('not-found');
  return album;
}

/**
 * Demo counterpart of a finished upload: the photo appears in the album as
 * still processing and turns ready a few seconds later, like the real pipeline.
 */
export function addDemoUploadedPhoto(albumId: string, fileName: string) {
  const album = albums.find((item) => item.id === albumId);
  const photos = photosByAlbum.get(albumId);
  if (!album || !photos) return;

  const url = SAMPLE_IMAGES[photos.length % SAMPLE_IMAGES.length];
  const photo: Photo = {
    id: `${albumId}-upload-${Date.now()}-${photos.length}`,
    filename: fileName,
    thumbnailUrl: url,
    previewUrl: url,
    blurDataUrl: null,
    width: null,
    height: null,
    isReady: false,
    createdAt: new Date().toISOString(),
  };

  photos.unshift(photo);
  album.photoCount = photos.length;
  if (!album.coverUrl) album.coverUrl = url;

  setTimeout(() => {
    photo.isReady = true;
  }, 6000);
}

export const demoData: DataSource = {
  async fetchAlbums() {
    await delay();
    return albums.map((album) => ({ ...album }));
  },

  async fetchAlbum(albumId) {
    await delay(120);
    return { ...findAlbum(albumId) };
  },

  async fetchPhotos(albumId, cursor) {
    await delay();
    const all = photosByAlbum.get(albumId) ?? [];
    let boundary: { createdAt: string; id?: string } | null = null;
    if (cursor) {
      try { boundary = JSON.parse(cursor); }
      catch { boundary = { createdAt: cursor }; }
    }
    const start = boundary
      ? all.findIndex((photo) => boundary.id ? photo.id === boundary.id : photo.createdAt === boundary.createdAt) + 1
      : 0;
    // Copies, so later changes to the fixtures never mutate what a screen holds.
    const photos = all.slice(start, start + PAGE_SIZE).map((photo) => ({ ...photo }));
    const hasMore = start + PAGE_SIZE < all.length;

    return {
      photos,
      nextCursor: hasMore ? JSON.stringify({
        createdAt: photos[photos.length - 1].createdAt,
        id: photos[photos.length - 1].id,
      }) : null,
    };
  },

  async fetchPhotoUpdates(albumId, ids) {
    await delay(120);
    findAlbum(albumId);
    const requested = new Set(ids);
    return (photosByAlbum.get(albumId) ?? [])
      .filter((photo) => requested.has(photo.id))
      .map((photo) => ({ ...photo }));
  },

  async fetchStorageUsage() {
    await delay(120);
    return {
      plan: 'starter',
      usedBytes: 7.4 * 1024 ** 3,
      limitBytes: 20 * 1024 ** 3,
    };
  },

  async createAlbum(input) {
    await delay(400);
    const album: Album = {
      id: `demo-${Date.now()}`,
      title: input.title,
      description: input.description || null,
      coverUrl: null,
      createdAt: new Date().toISOString(),
      shareToken: `demo-share-token-${Date.now()}`,
      allowDownload: true,
      downloadSize: 'hd',
      isPasswordProtected: false,
      photoCount: 0,
      autoFaceScan: true,
      autoPublish: false,
    };
    albums = [album, ...albums];
    photosByAlbum.set(album.id, []);
    return { ...album };
  },

  async updateAlbumDetails(input) {
    await delay(400);
    const album = findAlbum(input.albumId);
    album.title = input.title;
    album.description = input.description || null;
  },

  async fetchAlbumAccess(albumId, context) {
    const accessContext = captureAlbumAccessContext(context);
    await delay(120);
    if (!accessContext.isCurrent()) throw new DataError('unauthenticated');
    const settings = readDemoAccess(findAlbum(albumId));
    if (!accessContext.isCurrent()) throw new DataError('unauthenticated');
    return settings;
  },

  async updateAlbumAccess(input, context) {
    const accessContext = captureAlbumAccessContext(context);
    await delay(400);
    if (!accessContext.isCurrent()) throw new DataError('unauthenticated');
    if (!input || typeof input.albumId !== 'string' || !input.albumId) throw new DataError('server');
    const album = findAlbum(input.albumId);
    const current = readDemoAccess(album);
    if (typeof input.allowDownload !== 'boolean' || typeof input.isPasswordProtected !== 'boolean' ||
        typeof input.downloadSize !== 'string' || !['sd', 'hd', 'uhd', 'original'].includes(input.downloadSize) ||
        typeof input.revision !== 'string' || !/^[a-f0-9]{64}$/.test(input.revision) ||
        typeof input.password !== 'string' || passwordUtf8Bytes(input.password) > 72) {
      throw new DataError('server');
    }
    if (input.revision !== current.revision) throw new DataError('conflict');
    if (input.isPasswordProtected && !current.isPasswordProtected && !input.password) {
      throw new DataError('server');
    }
    if (!accessContext.isCurrent()) throw new DataError('unauthenticated');
    album.allowDownload = input.allowDownload;
    album.downloadSize = input.downloadSize;
    album.isPasswordProtected = input.isPasswordProtected;
    // Do not retain even a demo password. Only the protection flag is modeled.
    advanceAccessRevision(album.id);
  },

  async updateAlbumSettings(input) {
    await delay(400);
    const album = findAlbum(input.albumId);
    album.title = input.title;
    album.description = input.description || null;
    album.allowDownload = input.allowDownload;
    album.downloadSize = input.downloadSize;
    album.isPasswordProtected = input.isPasswordProtected;
    advanceAccessRevision(album.id);
  },

  async deleteAlbum(albumId) {
    await delay(400);
    findAlbum(albumId);
    albums = albums.filter((album) => album.id !== albumId);
    photosByAlbum.delete(albumId);
    accessRevisions.delete(albumId);
  },

  async setAlbumCover(albumId, photoId) {
    await delay(300);
    const album = findAlbum(albumId);
    const photo = (photosByAlbum.get(albumId) ?? []).find((item) => item.id === photoId);
    if (!photo) throw new DataError('not-found');
    album.coverUrl = photo.previewUrl || photo.thumbnailUrl;
  },
};
