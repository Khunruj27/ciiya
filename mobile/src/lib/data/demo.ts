import { SITE_URL } from '@/lib/config';

import {
  DataError,
  type Album,
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
  },
];

const photosByAlbum = new Map<string, Photo[]>(
  albums.map((album) => [album.id, makePhotos(album.id, album.photoCount)])
);

function findAlbum(albumId: string) {
  const album = albums.find((item) => item.id === albumId);
  if (!album) throw new DataError('not-found');
  return album;
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
    const start = cursor ? all.findIndex((photo) => photo.createdAt === cursor) + 1 : 0;
    const photos = all.slice(start, start + PAGE_SIZE);
    const hasMore = start + PAGE_SIZE < all.length;

    return {
      photos,
      nextCursor: hasMore ? photos[photos.length - 1].createdAt : null,
    };
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
    };
    albums = [album, ...albums];
    photosByAlbum.set(album.id, []);
    return { ...album };
  },

  async updateAlbumSettings(input) {
    await delay(400);
    const album = findAlbum(input.albumId);
    album.title = input.title;
    album.description = input.description || null;
    album.allowDownload = input.allowDownload;
    album.downloadSize = input.downloadSize;
    album.isPasswordProtected = input.isPasswordProtected;
  },

  async deleteAlbum(albumId) {
    await delay(400);
    findAlbum(albumId);
    albums = albums.filter((album) => album.id !== albumId);
    photosByAlbum.delete(albumId);
  },

  async setAlbumCover(albumId, photoId) {
    await delay(300);
    const album = findAlbum(albumId);
    const photo = (photosByAlbum.get(albumId) ?? []).find((item) => item.id === photoId);
    if (!photo) throw new DataError('not-found');
    album.coverUrl = photo.previewUrl || photo.thumbnailUrl;
  },
};
