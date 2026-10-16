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
  /** The album's upload defaults, applied to photos sent from the phone. */
  autoFaceScan: boolean;
  autoPublish: boolean;
};

export type PhotoProcessingStatus = 'pending' | 'processing' | 'done' | 'failed' | 'cancelled' | 'uploading' | 'finalizing' | 'unknown';

export type Photo = {
  id: string;
  filename: string | null;
  thumbnailUrl: string | null;
  previewUrl: string | null;
  blurDataUrl: string | null;
  width: number | null;
  height: number | null;
  isReady: boolean;
  /** Optional until the additive owner-read API is released. Missing is not pending/failed. */
  processingStatus?: PhotoProcessingStatus;
  processingProgress?: number | null;
  createdAt: string;
};

/** A display model only; it neither retries a job nor infers worker health. */
export function photoProcessing(photo: Photo) {
  const raw = photo.processingStatus;
  const status = photo.isReady === true ? 'ready'
    : raw === 'pending' || raw === 'processing' || raw === 'failed' || raw === 'cancelled' ||
      raw === 'uploading' || raw === 'finalizing' ? raw
      : raw === 'done' ? 'preparing' : 'unknown';
  const value = photo.processingProgress;
  const progress = status === 'processing' && typeof value === 'number' && Number.isFinite(value) &&
    value >= 0 && value <= 100 ? Math.round(value) : null;
  return { status, progress };
}

export function shouldPollPhoto(photo: Photo) {
  const { status } = photoProcessing(photo);
  return status !== 'ready' && status !== 'failed' && status !== 'cancelled';
}

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

/** Native editing is deliberately metadata-only; sharing flags are read-only. */
export type AlbumDetailsInput = {
  albumId: string;
  title: string;
  description: string;
};

/** Fresh, owner-scoped gallery access settings; never contains a password/hash. */
export type AlbumAccessSettings = {
  albumId: string;
  allowDownload: boolean;
  downloadSize: DownloadSize;
  isPasswordProtected: boolean;
  /** Opaque revision of the settings reviewed before an explicit save. */
  revision: string;
};

export type AlbumAccessInput = AlbumAccessSettings & {
  /** Empty preserves an existing protected password; no password is returned. */
  password: string;
};

/** The permanently fenced owner/focus lifetime captured by an access screen. */
export type AlbumAccessContext = {
  expectedOwnerId: string;
  isCurrent: () => boolean;
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

export type DataErrorKind = 'network' | 'unauthenticated' | 'not-found' | 'server' | 'conflict';

/** The only error the data layer throws; screens map `kind` to copy. */
export class DataError extends Error {
  kind: DataErrorKind;

  constructor(kind: DataErrorKind, message?: string) {
    super(message || kind);
    this.name = 'DataError';
    this.kind = kind;
  }
}

/** Freeze caller references once; later context edits cannot switch owner/guard. */
export function captureAlbumAccessContext(context: AlbumAccessContext): AlbumAccessContext {
  let expectedOwnerId: unknown;
  let predicate: unknown;
  try {
    expectedOwnerId = context?.expectedOwnerId;
    predicate = context?.isCurrent;
  } catch { throw new DataError('unauthenticated'); }
  if (typeof expectedOwnerId !== 'string' || !expectedOwnerId || typeof predicate !== 'function') {
    throw new DataError('unauthenticated');
  }
  const capturedPredicate = predicate;
  const isCurrent = () => {
    try { return capturedPredicate() === true; }
    catch { return false; }
  };
  if (!isCurrent()) throw new DataError('unauthenticated');
  return { expectedOwnerId, isCurrent };
}

/**
 * What the server did with one reprocessing request. `already-queued` means the
 * worker already had the photo; `source-missing` means its original is gone, so
 * retrying again cannot help; `not-retryable` means it is no longer failed.
 */
/** A Lightroom preset this album's uploads may use. */
export type AlbumPreset = {
  /** Passed to the upload routes as `presetPath`. */
  path: string;
  name: string;
  createdAt: string | null;
};

/** One .xmp file read on the phone, sent as text. */
export type AlbumPresetUpload = { fileName: string; content: string };

/**
 * What happened to a deletion request. `gone` means the photo no longer exists
 * (for example an earlier request whose reply was lost); `processing` means the
 * server refused because the worker may still write previews for it.
 */
export type PhotoDeleteOutcome = 'deleted' | 'gone' | 'processing';

export type PhotoRetryOutcome = 'queued' | 'already-queued' | 'source-missing' | 'not-retryable';

export type DataSource = {
  fetchAlbums(): Promise<Album[]>;
  fetchAlbum(albumId: string): Promise<Album>;
  fetchPhotos(albumId: string, cursor?: string | null): Promise<PhotoPage>;
  /** Bounded, owner-scoped updates for already loaded processing photos. */
  fetchPhotoUpdates(albumId: string, ids: string[]): Promise<Photo[]>;
  /** An expected account prevents an old screen from reading a new session's row. */
  fetchStorageUsage(expectedOwnerId?: string): Promise<StorageUsage>;
  /** A confirmed create returns its ID; the destination loads/retries the details. */
  createAlbum(input: CreateAlbumInput): Promise<Pick<Album, 'id'>>;
  updateAlbumDetails(input: AlbumDetailsInput): Promise<void>;
  fetchAlbumAccess(albumId: string, context: AlbumAccessContext): Promise<AlbumAccessSettings>;
  updateAlbumAccess(input: AlbumAccessInput, context: AlbumAccessContext): Promise<void>;
  /** Legacy full-settings transport is unavailable to native real accounts. */
  updateAlbumSettings(input: AlbumSettingsInput): Promise<void>;
  deleteAlbum(albumId: string): Promise<void>;
  setAlbumCover(albumId: string, photoId: string): Promise<void>;
  /** Sends one failed/stopped photo back to the photo worker. */
  retryPhotoProcessing(albumId: string, photoId: string): Promise<PhotoRetryOutcome>;
  /** Permanently deletes one photo and its stored files. */
  deletePhoto(albumId: string, photoId: string): Promise<PhotoDeleteOutcome>;
  /** The album's own presets plus account-wide legacy ones, newest first. */
  fetchAlbumPresets(albumId: string): Promise<AlbumPreset[]>;
  /** Stores a new preset for this album and returns it. */
  uploadAlbumPreset(albumId: string, input: AlbumPresetUpload): Promise<AlbumPreset>;
};
