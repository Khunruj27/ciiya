import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REVISION_PATTERN = /^[0-9a-f]{64}$/
const BCRYPT_PATTERN = /^\$2[aby]\$(0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{53}$/
const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }

export const ALBUM_ACCESS_COLUMNS =
  'id,allow_download,allow_original_download,download_size,is_password_protected,password_hash'

export type AlbumAccessDownloadSize = 'sd' | 'hd' | 'uhd' | 'original'

/** Preserve nullable legacy values for revisions and compare-and-set filters. */
export type AlbumAccessRow = {
  id: string
  allow_download: boolean | null
  allow_original_download: boolean | null
  download_size: AlbumAccessDownloadSize | null
  is_password_protected: boolean | null
  password_hash: string | null
}

export type AlbumAccessSettings = {
  albumId: string
  allowDownload: boolean
  downloadSize: AlbumAccessDownloadSize
  isPasswordProtected: boolean
  revision: string
}

export type AlbumAccessInput = {
  allowDownload: boolean
  downloadSize: AlbumAccessDownloadSize
  isPasswordProtected: boolean
  password: string
  revision: string
}

export function albumAccessJson(
  body: { settings: AlbumAccessSettings } | { success: true } | { error: string },
  status = 200
) {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

export function isAlbumAccessId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

function isDownloadSize(value: unknown): value is AlbumAccessDownloadSize {
  return value === 'sd' || value === 'hd' || value === 'uhd' || value === 'original'
}

export function hasValidAlbumPasswordHash(value: unknown): value is string {
  return typeof value === 'string' && BCRYPT_PATTERN.test(value)
}

/** Never silently coerce corrupt access settings or return their raw values. */
export function readAlbumAccessRow(value: unknown, albumId: string): AlbumAccessRow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const nullableBoolean = (field: string) => row[field] === null || typeof row[field] === 'boolean'
  if (
    row.id !== albumId || !isAlbumAccessId(row.id) ||
    !nullableBoolean('allow_download') || !nullableBoolean('allow_original_download') ||
    !nullableBoolean('is_password_protected') ||
    (row.download_size !== null && !isDownloadSize(row.download_size)) ||
    (row.password_hash !== null && !hasValidAlbumPasswordHash(row.password_hash))
  ) return null

  return {
    id: albumId,
    allow_download: row.allow_download as boolean | null,
    allow_original_download: row.allow_original_download as boolean | null,
    download_size: row.download_size as AlbumAccessDownloadSize | null,
    is_password_protected: row.is_password_protected as boolean | null,
    password_hash: row.password_hash as string | null,
  }
}

/** A hash change invalidates a review even when protection remains enabled. */
export function albumAccessRevision(row: AlbumAccessRow) {
  return createHash('sha256').update(JSON.stringify([
    'ciiya-mobile-album-access-v1', row.id, row.allow_download,
    row.allow_original_download, row.download_size, row.is_password_protected,
    row.password_hash,
  ])).digest('hex')
}

export function albumAccessSettings(row: AlbumAccessRow): AlbumAccessSettings {
  return {
    albumId: row.id,
    allowDownload: row.allow_download !== false,
    downloadSize: row.download_size ?? 'hd',
    isPasswordProtected: row.is_password_protected === true,
    revision: albumAccessRevision(row),
  }
}

/** Only access fields are writable; password byte limit precedes bcrypt work. */
export function readAlbumAccessInput(value: unknown): AlbumAccessInput | null {
  if (
    !value || typeof value !== 'object' || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) return null
  const input = value as Record<string, unknown>
  const fields = ['allowDownload', 'downloadSize', 'isPasswordProtected', 'password', 'revision']
  if (Object.keys(input).length !== fields.length || !fields.every((field) => Object.hasOwn(input, field))) return null
  if (
    typeof input.allowDownload !== 'boolean' || !isDownloadSize(input.downloadSize) ||
    typeof input.isPasswordProtected !== 'boolean' || typeof input.password !== 'string' ||
    input.password.length > 72 ||
    typeof input.revision !== 'string' || !REVISION_PATTERN.test(input.revision)
  ) return null

  // Trim matches the accepted browser settings endpoint. Bcrypt silently
  // truncates after 72 UTF-8 bytes, so reject instead of changing the secret.
  const password = input.password.trim()
  if (Buffer.byteLength(password, 'utf8') > 72) return null

  return {
    allowDownload: input.allowDownload,
    downloadSize: input.downloadSize,
    isPasswordProtected: input.isPasswordProtected,
    password,
    revision: input.revision,
  }
}
