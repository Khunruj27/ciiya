import { requireOptionalNativeModule } from 'expo';
import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { createAlbumQr } from './album-qr';

export function deliveryNativeCapabilities() {
  if (Platform.OS === 'web') return { copy: true, downloadQr: false };
  return {
    copy: Boolean(requireOptionalNativeModule('ExpoClipboard')),
    downloadQr: Boolean(requireOptionalNativeModule('ExpoSharing')),
  };
}

/** Write only; never read or subscribe to the user's existing clipboard. */
export async function copyGalleryLink(link: string, isCurrent: () => boolean) {
  const Clipboard = await import('expo-clipboard');
  if (!isCurrent()) return false;
  return Clipboard.setStringAsync(link);
}

/** Native Save-to-Files/share flow for the same SVG exported by the web app. */
export async function exportGalleryQr(link: string, isCurrent: () => boolean, dialogTitle: string) {
  const Sharing = await import('expo-sharing');
  if (!isCurrent()) return;
  if (!await Sharing.isAvailableAsync()) throw new Error('Sharing unavailable');
  if (!isCurrent()) return;
  const artifact = await createAlbumQr(link);
  if (!isCurrent()) return;
  const directory = new Directory(Paths.cache, 'ciiya-share-qr');
  directory.create({ idempotent: true, intermediates: true });
  const file = new File(directory, `ciiya-share-qr-${randomUUID()}.svg`);
  let created = false;
  let handedOff = false;
  try {
    file.create();
    created = true;
    file.write(artifact.svg);
    if (!isCurrent()) return;
    handedOff = true;
    await Sharing.shareAsync(file.uri, { mimeType: 'image/svg+xml', UTI: 'public.svg-image', dialogTitle });
    // Completion/cancellation does not prove a save/send. Retain this OS-evictable
    // cache file for recipients consuming it after Android's promise resolves.
    // No existing cache, photo or source objects are swept.
  } finally {
    if (created && !handedOff && file.exists) file.delete();
  }
}
