import { NextResponse } from 'next/server'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }
const SAFE_OBJECT_NAME = /^[A-Za-z0-9._-]{1,200}\.xmp$/i

/** Same limit as the website's preset upload. */
export const MAX_PRESET_BYTES = 2 * 1024 * 1024
export const MAX_LISTED_PRESETS = 100

export type MobileAlbumPreset = {
  /** The storage key the upload routes accept as `presetPath`. */
  path: string
  name: string
  createdAt: string | null
}

export type PresetUploadInput = { fileName: string; content: string }

export function albumPresetJson(
  body: { presets: MobileAlbumPreset[] } | { preset: MobileAlbumPreset } | { error: string; code?: string },
  status = 200
) {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

export function isAlbumPresetId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

/** A display name: no folders, timestamp prefixes or extension. */
export function cleanPresetName(value: string) {
  const name = value.split('/').pop()!.replace(/^\d+-/, '').replace(/\.xmp$/i, '').trim()
  return name.slice(0, 120) || 'Preset'
}

/**
 * Only presets the photo upload routes will accept for this album: the album's
 * own presets and the owner's account-wide (legacy) ones. A preset stored under
 * another album would be refused at upload time, so it is never offered.
 */
export function isUsablePresetPath(path: unknown, ownerId: string, albumId: string): path is string {
  if (typeof path !== 'string' || path.length > 500) return false
  const lower = path.toLowerCase()
  if (path.includes('..') || path.includes('\\') || path.includes('//') ||
    lower.includes('%2e') || lower.includes('%2f') || lower.includes('%5c')) return false
  for (const prefix of [`${ownerId}/${albumId}/presets/`, `${ownerId}/presets/`]) {
    if (path.startsWith(prefix) && SAFE_OBJECT_NAME.test(path.slice(prefix.length))) return true
  }
  return false
}

/** Exactly `{ fileName, content }`: an .xmp name and its UTF-8 text. */
export function readPresetUpload(value: unknown): PresetUploadInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) return null
  const input = value as Record<string, unknown>
  const keys = Object.keys(input)
  if (keys.length !== 2 || !Object.hasOwn(input, 'fileName') || !Object.hasOwn(input, 'content')) return null
  if (typeof input.fileName !== 'string' || typeof input.content !== 'string') return null

  const fileName = input.fileName.replace(/[\\/]/g, '-').trim()
  if (!fileName || fileName.length > 255 || !fileName.toLowerCase().endsWith('.xmp')) return null

  const bytes = Buffer.byteLength(input.content, 'utf8')
  if (bytes < 1 || bytes > MAX_PRESET_BYTES || input.content.includes('\u0000')) return null
  // A Lightroom/Camera Raw preset is an XMP packet; anything else cannot be applied.
  if (!/<x:xmpmeta[\s>]/i.test(input.content)) return null

  return { fileName, content: input.content }
}
