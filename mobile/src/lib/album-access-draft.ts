import type { AlbumAccessSettings, DownloadSize } from '@/lib/data/types';

export type AlbumAccessDraft = {
  allowDownload: boolean;
  downloadSize: DownloadSize;
  isPasswordProtected: boolean;
  password: string;
};

export function albumAccessDraft(settings: AlbumAccessSettings): AlbumAccessDraft {
  return {
    allowDownload: settings.allowDownload,
    downloadSize: settings.downloadSize,
    isPasswordProtected: settings.isPasswordProtected,
    password: '',
  };
}

export function hasAlbumAccessChanges(settings: AlbumAccessSettings, draft: AlbumAccessDraft): boolean {
  return settings.allowDownload !== draft.allowDownload ||
    settings.downloadSize !== draft.downloadSize ||
    settings.isPasswordProtected !== draft.isPasswordProtected ||
    (draft.isPasswordProtected && Boolean(draft.password.trim()));
}

/** Count UTF-8 without assuming TextEncoder exists in a native Hermes build. */
function passwordBytes(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    // Unpaired surrogates are not a valid password-byte contract.
    if (point >= 0xd800 && point <= 0xdfff) return Infinity;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}

export function validateAlbumAccessDraft(
  settings: AlbumAccessSettings,
  draft: AlbumAccessDraft
): 'password-required' | 'password-too-long' | 'invalid-settings' | null {
  if (typeof draft.allowDownload !== 'boolean' || typeof draft.isPasswordProtected !== 'boolean' ||
    !['sd', 'hd', 'uhd', 'original'].includes(draft.downloadSize) || typeof draft.password !== 'string') {
    return 'invalid-settings';
  }
  // Turning protection off never sends a lingering text-field password.
  if (!draft.isPasswordProtected) return null;
  const password = draft.password.trim();
  if (!settings.isPasswordProtected && !password) return 'password-required';
  if (passwordBytes(password) > 72) return 'password-too-long';
  return null;
}
