import { shareUrl } from '@/lib/config';
import { DataError, type Album, type DataErrorKind } from '@/lib/data/types';

export type AlbumDeliveryKind = 'share' | 'preview' | 'copy' | 'qr' | 'download-qr';
export type AlbumDeliveryErrorKind = DataErrorKind | 'unavailable' | 'settings-changed';

export type AlbumDeliveryActionsOptions = {
  albumId: string;
  /** An owner-scoped read, not a cached album or a share-token creation call. */
  readAlbum(): Promise<Album>;
  /** Settings the photographer has actually seen on the delivery screen. */
  getReviewedAlbum?(): Album | null;
  /** Refresh the review only; a settings change never also opens native UI. */
  onReviewUpdated?(album: Album): void;
  /** The screen is focused and still belongs to the same account/context. */
  isCurrent(): boolean;
  platform: string;
  shareNative(content: { message: string; url?: string }): Promise<unknown>;
  previewNative(url: string): Promise<unknown>;
  /** Recheck the supplied predicate after any module/permission await. */
  copyNative?(url: string, isCurrent: () => boolean): Promise<boolean>;
  showQr?(url: string, isCurrent: () => boolean): Promise<void>;
  downloadQrNative?(url: string, isCurrent: () => boolean): Promise<void>;
  onCopied?(url: string): void;
  makeMessage(title: string): string;
  untitled: string;
  onBusy(kind: AlbumDeliveryKind | null): void;
  onError(kind: AlbumDeliveryErrorKind): void;
};

/** Only an existing, opaque public-gallery token may leave the app. */
export function getAlbumDeliveryLink(token: string | null): string | null {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(token)) return null;

  try {
    const link = shareUrl(token);
    // URL parsing can silently repair whitespace, backslashes and dot segments.
    // Refuse those repairs and any non-gallery configuration instead.
    if (typeof link !== 'string' || !/^https?:\/\//.test(link) || /[\s\\]/.test(link)) {
      return null;
    }
    const parsed = new URL(link);
    const localDevelopment = __DEV__ &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
    if (
      (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && localDevelopment)) ||
      !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash ||
      parsed.pathname !== `/share/${token}` || parsed.href !== link
    ) {
      return null;
    }
    return link;
  } catch {
    return null;
  }
}

/** Never retain unexpected password/hash/auth fields from a runtime response. */
function reviewedSnapshot(album: Album): Album {
  return {
    id: album.id,
    title: album.title,
    description: album.description,
    coverUrl: album.coverUrl,
    createdAt: album.createdAt,
    shareToken: album.shareToken,
    allowDownload: album.allowDownload,
    downloadSize: album.downloadSize,
    isPasswordProtected: album.isPasswordProtected,
    photoCount: album.photoCount,
    autoFaceScan: album.autoFaceScan,
    autoPublish: album.autoPublish,
  };
}

/**
 * External activity starts only from run(), after a fresh owner-scoped read.
 * dispose()/activate() invalidate pending reads even if the same account returns
 * later. Retain the single flight until the native promise settles; do not add
 * a deadline that permits a second share sheet over the first. Android browser
 * preview resolves when opened, not necessarily when dismissed; its caller
 * must guard the browser's own locked/presentation state.
 */
export function createAlbumDeliveryActions(options: AlbumDeliveryActionsOptions) {
  let active = true;
  let generation = 0;
  let inFlight: AlbumDeliveryKind | null = null;

  const current = (runGeneration: number) =>
    active && generation === runGeneration && options.isCurrent();

  return {
    activate() {
      if (active) return;
      active = true;
      generation += 1;
      if (options.isCurrent()) options.onBusy(inFlight);
    },
    dispose() {
      if (!active) return;
      active = false;
      generation += 1;
    },
    async run(kind: AlbumDeliveryKind): Promise<void> {
      if (!['share', 'preview', 'copy', 'qr', 'download-qr'].includes(kind)) return;
      if (!active || inFlight || !options.isCurrent()) return;
      const runGeneration = generation;
      // Lock synchronously, before state changes or any async boundary.
      inFlight = kind;
      let phase: 'read' | 'native' = 'read';
      try {
        options.onBusy(kind);
        if (!current(runGeneration)) return;
        const album = await options.readAlbum();
        if (!current(runGeneration)) return;
        if (!album || album.id !== options.albumId) {
          options.onError('not-found');
          return;
        }
        if (options.getReviewedAlbum) {
          const reviewed = options.getReviewedAlbum();
          if (!current(runGeneration)) return;
          if (!reviewed || reviewed.id !== options.albumId) {
            options.onError(reviewed ? 'not-found' : 'unavailable');
            return;
          }
          if (reviewed.isPasswordProtected !== album.isPasswordProtected ||
            reviewed.allowDownload !== album.allowDownload ||
            reviewed.downloadSize !== album.downloadSize ||
            reviewed.shareToken !== album.shareToken) {
            if (!current(runGeneration)) return;
            options.onReviewUpdated?.(reviewedSnapshot(album));
            if (current(runGeneration)) options.onError('settings-changed');
            return;
          }
        }
        const link = getAlbumDeliveryLink(album.shareToken);
        if (!link) {
          options.onError('unavailable');
          return;
        }

        if (kind === 'share') {
          const title = typeof album.title === 'string' ? album.title.trim() : '';
          const message = options.makeMessage(title || options.untitled);
          // The callback above may reflect a changed render/context. Recheck at
          // the last possible point before giving the native OS a public link.
          if (!current(runGeneration)) return;
          phase = 'native';
          await options.shareNative(options.platform === 'ios'
            ? { message, url: link }
            : { message: `${message}\n${link}` });
        } else if (kind === 'preview') {
          if (!current(runGeneration)) return;
          phase = 'native';
          await options.previewNative(link);
        } else {
          const isCurrent = () => current(runGeneration);
          if (!isCurrent()) return;
          phase = 'native';
          if (kind === 'copy') {
            if (!options.copyNative) throw new Error('Clipboard unavailable');
            const copied = await options.copyNative(link, isCurrent);
            if (copied && isCurrent()) options.onCopied?.(link);
            else if (isCurrent()) options.onError('unavailable');
          } else if (kind === 'qr') {
            if (!options.showQr) throw new Error('QR unavailable');
            await options.showQr(link, isCurrent);
          } else if (kind === 'download-qr') {
            if (!options.downloadQrNative) throw new Error('QR export unavailable');
            await options.downloadQrNative(link, isCurrent);
          }
        }
        // Native completion/cancellation never proves a client received a link.
      } catch (error) {
        if (!current(runGeneration)) return;
        const readKind = error instanceof DataError &&
          (error.kind === 'network' || error.kind === 'unauthenticated' ||
            error.kind === 'not-found' || error.kind === 'server')
          ? error.kind : 'server';
        options.onError(phase === 'native' ? 'unavailable'
          : readKind);
      } finally {
        inFlight = null;
        // Do not leave a reactivated screen busy when an invalidated read ends.
        // This is only a local release, never an old read result/error/action.
        if (active && options.isCurrent()) options.onBusy(null);
      }
    },
  };
}
