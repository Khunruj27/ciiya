/*
 * Contact fields are typed by hand, so people put in whatever they have —
 * "@ciiya.studio", "ciiya.studio", or the full URL. Each helper takes all
 * three and returns something a browser can actually open.
 */

export function instagramUrl(value: string) {
  const handle = value.trim().replace(/^@/, '')
  if (/^https?:\/\//i.test(handle)) return handle
  return `https://instagram.com/${handle.replace(/^instagram\.com\//i, '')}`
}

export function facebookUrl(value: string) {
  const target = value.trim().replace(/^@/, '')
  if (/^https?:\/\//i.test(target)) return target
  return `https://facebook.com/${target.replace(/^(www\.)?facebook\.com\//i, '')}`
}

export function tiktokUrl(value: string) {
  const target = value.trim().replace(/^@/, '')
  if (/^https?:\/\//i.test(target)) return target
  return `https://tiktok.com/@${target.replace(/^(www\.)?tiktok\.com\/@?/i, '')}`
}

export function websiteUrl(value: string) {
  const target = value.trim()
  if (/^https?:\/\//i.test(target)) return target
  return `https://${target}`
}

export function lineUrl(value: string) {
  const id = value.trim().replace(/^@/, '')
  if (/^https?:\/\//i.test(id)) return id
  return `https://line.me/ti/p/~${id}`
}

export function telUrl(value: string) {
  return `tel:${value.replace(/[^\d+]/g, '')}`
}

export function displayHandle(value: string) {
  const trimmed = value.trim()
  if (!/^https?:\/\//i.test(trimmed)) return trimmed
  return trimmed.replace(/^https?:\/\//i, '').replace(/\/$/, '')
}
