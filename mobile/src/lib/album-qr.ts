import { toString } from 'qrcode';

import { getAlbumDeliveryLink } from './album-delivery';

/** Same SVG format as the website; generated locally, without a QR service. */
export async function createAlbumQr(link: string) {
  const token = new URL(link).pathname.slice('/share/'.length);
  if (link.length > 1000 || !/^[\x21-\x7e]+$/.test(link) || getAlbumDeliveryLink(token) !== link) {
    throw new Error('Invalid gallery link');
  }
  // Canonical gallery URLs are ASCII. Supplying bytes avoids depending on a
  // browser TextEncoder polyfill in the phone's JavaScript runtime.
  const bytes = Uint8Array.from(link, char => char.charCodeAt(0));
  const svg = await toString([{ data: bytes, mode: 'byte' }], {
    type: 'svg', errorCorrectionLevel: 'M', margin: 4, width: 1024,
  });
  return { link, svg, uri: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` };
}
