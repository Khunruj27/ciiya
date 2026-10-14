/** The size the server renders for delivery; `original` keeps full resolution. */
export type UploadSize = 'sd' | 'hd' | 'uhd' | 'original';

/** The only formats the upload API accepts; anything else is converted first. */
export type UploadMimeType = 'image/jpeg' | 'image/png' | 'image/webp';

export type UploadStatus =
  | 'queued'
  | 'uploading'
  /** Bytes are stored; the server is registering the photo. */
  | 'finishing'
  | 'done'
  /** The album already holds this exact photo, so nothing was added. */
  | 'duplicate'
  | 'failed';

/** Why an upload stopped. Screens map these to copy. */
export type UploadFailure =
  | 'network'
  | 'server'
  | 'storage-full'
  /** The server no longer accepts this sign-in; signing in again fixes it. */
  | 'session'
  | 'album-missing'
  /** The server refused the file itself (type, size, name). */
  | 'rejected'
  /** The queued copy is no longer on this phone. */
  | 'file-missing';

/**
 * A file that is already in Supabase Storage but not yet confirmed as a photo
 * (only accounts that have not moved to R2 upload this way).
 */
export type StagedObject = {
  storagePath: string;
  /**
   * Durably set BEFORE attempting registration. A crash or lost answer may
   * leave the server with an accepted photo, so this file must not be deleted.
   */
  uncertain: boolean;
};

export type UploadItem = {
  /** Also the server's `clientUploadId`, which makes a retry idempotent. */
  id: string;
  /** Whose queue this belongs to; another account never sees or sends it. */
  ownerId: string;
  albumId: string;
  fileName: string;
  mimeType: UploadMimeType;
  sizeBytes: number;
  /** Content-based, so the server can tell a re-picked photo is a duplicate. */
  fileHash: string;
  /**
   * File name inside the uploads directory. Never a full path: iOS moves the
   * app container between updates, so absolute paths do not survive.
   */
  localName: string;
  size: UploadSize;
  autoFaceScan: boolean;
  autoPublish: boolean;
  status: UploadStatus;
  /** 0–1 for the current attempt. */
  progress: number;
  /** Automatic attempts used so far; reset by a manual retry. */
  attempts: number;
  failure: UploadFailure | null;
  /**
   * True once the server was asked to register this photo. If a later attempt
   * is told "already in the album", that earlier request is what put it there.
   */
  registering: boolean;
  staged: StagedObject | null;
  createdAt: number;
};

/** A photo picked from the library and copied into the uploads directory. */
export type PreparedFile = {
  fileName: string;
  mimeType: UploadMimeType;
  sizeBytes: number;
  fileHash: string;
  localName: string;
};

export type UploadOptions = {
  size: UploadSize;
  autoFaceScan: boolean;
  autoPublish: boolean;
};

/**
 * Raised by a transport. `retryable` failures are tried again automatically;
 * `signedOut` (no session on this phone) pauses the whole queue until the
 * photographer signs back in.
 */
export class UploadError extends Error {
  failure: UploadFailure;
  retryable: boolean;
  signedOut: boolean;

  constructor(
    failure: UploadFailure,
    options: { retryable?: boolean; signedOut?: boolean; message?: string } = {}
  ) {
    super(options.message || failure);
    this.name = 'UploadError';
    this.failure = failure;
    this.retryable = options.retryable ?? false;
    this.signedOut = options.signedOut ?? false;
  }
}

/** One full attempt at sending a queued photo. */
export type UploadTransport = {
  upload(
    item: UploadItem,
    hooks: {
      onProgress: (progress: number) => void;
      /** Must persist registration intent synchronously, or throw before sending. */
      onFinishing: () => void;
      /** Records (or clears) a stored-but-unconfirmed file so a retry reuses it. */
      onStaged: (staged: StagedObject | null) => void;
      signal: AbortSignal;
    }
  ): Promise<'done' | 'duplicate'>;
  /** Best-effort clean-up when the photographer removes an unfinished upload. */
  discard?(item: UploadItem): void;
};
