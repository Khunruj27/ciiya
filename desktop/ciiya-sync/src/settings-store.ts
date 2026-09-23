import crypto from 'node:crypto'
import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  CIIYA_SYNC_DEFAULT_API_URL,
  CIIYA_SYNC_DESKTOP_SETTINGS_VERSION,
  type CiiyaSyncDesktopPlatform,
  type CiiyaSyncDesktopSettings,
} from './contracts'

function normalizeApiBaseUrl(value: unknown) {
  const url = new URL(String(value || CIIYA_SYNC_DEFAULT_API_URL))
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Ciiya API URL must use HTTP or HTTPS')
  }
  return url.toString().replace(/\/$/, '')
}

function cleanText(value: unknown, maximum: number) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, maximum)
}

function defaultDeviceName() {
  return cleanText(os.hostname(), 80) || 'Ciiya Sync computer'
}

function defaultSettings(apiBaseUrl?: string): CiiyaSyncDesktopSettings {
  return {
    version: CIIYA_SYNC_DESKTOP_SETTINGS_VERSION,
    apiBaseUrl: normalizeApiBaseUrl(apiBaseUrl),
    clientDeviceId: crypto.randomUUID(),
    deviceName: defaultDeviceName(),
    folderPath: null,
    albumId: null,
    deviceId: null,
    ownerId: null,
    tokenExpiresAt: null,
    autoStart: false,
    updatedAt: new Date().toISOString(),
  }
}

function normalizeSettings(
  value: Partial<CiiyaSyncDesktopSettings>,
  apiBaseUrl?: string
): CiiyaSyncDesktopSettings {
  const defaults = defaultSettings(apiBaseUrl)
  return {
    version: CIIYA_SYNC_DESKTOP_SETTINGS_VERSION,
    apiBaseUrl: normalizeApiBaseUrl(apiBaseUrl || value.apiBaseUrl),
    clientDeviceId: /^[0-9a-f-]{36}$/i.test(String(value.clientDeviceId || ''))
      ? String(value.clientDeviceId)
      : defaults.clientDeviceId,
    deviceName: cleanText(value.deviceName, 80) || defaults.deviceName,
    folderPath:
      typeof value.folderPath === 'string' && value.folderPath.trim()
        ? path.resolve(value.folderPath)
        : null,
    albumId:
      typeof value.albumId === 'string' && value.albumId.trim()
        ? value.albumId.trim()
        : null,
    deviceId:
      typeof value.deviceId === 'string' && value.deviceId.trim()
        ? value.deviceId.trim()
        : null,
    ownerId:
      typeof value.ownerId === 'string' && value.ownerId.trim()
        ? value.ownerId.trim()
        : null,
    tokenExpiresAt:
      typeof value.tokenExpiresAt === 'string' && value.tokenExpiresAt.trim()
        ? value.tokenExpiresAt.trim()
        : null,
    autoStart: value.autoStart === true,
    updatedAt: new Date().toISOString(),
  }
}

async function atomicWrite(filePath: string, data: string | Uint8Array) {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`
  await writeFile(temporaryPath, data, { mode: 0o600 })
  const handle = await open(temporaryPath, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporaryPath, filePath)
}

export class CiiyaSyncSettingsStore {
  private settings: CiiyaSyncDesktopSettings | null = null

  constructor(
    readonly filePath: string,
    private apiBaseUrlOverride?: string
  ) {}

  async load() {
    if (this.settings) return structuredClone(this.settings)

    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8'))
      this.settings = normalizeSettings(parsed, this.apiBaseUrlOverride)
    } catch {
      this.settings = defaultSettings(this.apiBaseUrlOverride)
    }

    await this.persist()
    return structuredClone(this.settings)
  }

  async update(patch: Partial<CiiyaSyncDesktopSettings>) {
    const current = await this.load()
    this.settings = normalizeSettings(
      { ...current, ...patch, clientDeviceId: current.clientDeviceId },
      this.apiBaseUrlOverride
    )
    await this.persist()
    return structuredClone(this.settings)
  }

  private async persist() {
    if (!this.settings) return
    await atomicWrite(
      this.filePath,
      `${JSON.stringify(this.settings, null, 2)}\n`
    )
  }
}

export type CiiyaSyncEncryptionAdapter = {
  isAvailable(): boolean
  encrypt(value: string): Uint8Array
  decrypt(value: Uint8Array): string
}

export class CiiyaSyncCredentialStore {
  constructor(
    readonly filePath: string,
    private encryption: CiiyaSyncEncryptionAdapter
  ) {}

  async save(deviceToken: string) {
    if (!/^ciiya_sync_[A-Za-z0-9_-]{43}$/.test(deviceToken)) {
      throw new Error('Invalid Ciiya Sync device token')
    }
    if (!this.encryption.isAvailable()) {
      throw new Error('Operating-system credential encryption is unavailable')
    }
    await atomicWrite(this.filePath, this.encryption.encrypt(deviceToken))
  }

  async load() {
    if (!this.encryption.isAvailable()) return null
    try {
      const token = this.encryption.decrypt(await readFile(this.filePath))
      return /^ciiya_sync_[A-Za-z0-9_-]{43}$/.test(token) ? token : null
    } catch {
      return null
    }
  }

  async clear() {
    const { rm } = await import('node:fs/promises')
    await rm(this.filePath, { force: true })
  }
}

export function desktopPlatform(value = process.platform): CiiyaSyncDesktopPlatform {
  if (value === 'darwin') return 'macos'
  if (value === 'win32') return 'windows'
  if (value === 'linux') return 'linux'
  return 'unknown'
}
