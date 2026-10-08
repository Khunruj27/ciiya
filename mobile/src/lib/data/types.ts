export type DownloadSize = 'sd' | 'hd' | 'uhd' | 'original';

export type Album = {
  id: string;
  title: string | null;
  description: string | null;
  coverUrl: string | null;
  createdAt: string;
  shareToken: string | null;
  allowDownload: boolean;
  downloadSize: DownloadSize;
  isPasswordProtected: boolean;
  photoCount: number;
};

export type Photo = {
  id: string;
  filename: string | null;
  thumbnailUrl: string | null;
  previewUrl: string | null;
  blurDataUrl: string | null;
  width: number | null;
  height: number | null;
  isReady: boolean;
  createdAt: string;
};

export type PhotoPage = {
  photos: Photo[];
  /** Pass back to load the next (older) page; null when there is no more. */
  nextCursor: string | null;
};

export type StorageUsage = {
  plan: string;
  usedBytes: number;
  limitBytes: number;
};

export type CreateAlbumInput = {
  title: string;
  description: string;
};

export type AlbumSettingsInput = {
  albumId: string;
  title: string;
  description: string;
  allowDownload: boolean;
  downloadSize: DownloadSize;
  isPasswordProtected: boolean;
  /** Empty keeps the current password when protection is already on. */
  password: string;
};

export type DataErrorKind = 'network' | 'unauthenticated' | 'not-found' | 'server';

/** The only error the data layer throws; screens map `kind` to copy. */
export class DataError extends Error {
  kind: DataErrorKind;

  constructor(kind: DataErrorKind, message?: string) {
    super(message || kind);
    this.name = 'DataError';
    this.kind = kind;
  }
}

export type DataSource = {
  fetchAlbums(): Promise<Album[]>;
  fetchAlbum(albumId: string): Promise<Album>;
  fetchPhotos(albumId: string, cursor?: string | null): Promise<PhotoPage>;
  fetchStorageUsage(): Promise<StorageUsage>;
  createAlbum(input: CreateAlbumInput): Promise<Album>;
  updateAlbumSettings(input: AlbumSettingsInput): Promise<void>;
  deleteAlbum(albumId: string): Promise<void>;
  setAlbumCover(albumId: string, photoId: string): Promise<void>;
};
