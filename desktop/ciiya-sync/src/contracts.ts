import type {
  CiiyaSyncQueueItem,
  CiiyaSyncQueueStatus,
} from '../../../src/lib/ciiya-sync/local'
import type { CiiyaSyncSessionSummary } from './session-telemetry'

export const CIIYA_SYNC_DESKTOP_SETTINGS_VERSION = 1
export const CIIYA_SYNC_DEFAULT_API_URL = 'https://ciiya.vercel.app'

export type CiiyaSyncDesktopPlatform = 'macos' | 'windows' | 'linux' | 'unknown'

export type CiiyaSyncDesktopSettings = {
  version: typeof CIIYA_SYNC_DESKTOP_SETTINGS_VERSION
  apiBaseUrl: string
  clientDeviceId: string
  deviceName: string
  folderPath: string | null
  albumId: string | null
  deviceId: string | null
  ownerId: string | null
  tokenExpiresAt: string | null
  autoStart: boolean
  updatedAt: string
}

export type CiiyaSyncDesktopAlbum = {
  id: string
  title: string
  description: string | null
  coverUrl: string | null
  status: string | null
  photoCount: number
  updatedAt: string | null
}

export type CiiyaSyncPairingState = {
  status: 'idle' | 'starting' | 'waiting' | 'connected' | 'expired' | 'error'
  userCode: string | null
  verificationUriComplete: string | null
  expiresAt: string | null
  error: string | null
}

export type CiiyaSyncDesktopQueueItem = Pick<
  CiiyaSyncQueueItem,
  | 'id'
  | 'albumId'
  | 'sourcePath'
  | 'fileName'
  | 'fileSizeBytes'
  | 'status'
  | 'attempts'
  | 'nextAttemptAt'
  | 'photoId'
  | 'processingStatus'
  | 'error'
  | 'createdAt'
  | 'updatedAt'
  | 'completedAt'
>

export type CiiyaSyncDesktopQueueSummary = Record<CiiyaSyncQueueStatus, number>

export type CiiyaSyncDesktopLiveStatus =
  | 'paused'
  | 'watching'
  | 'syncing'
  | 'waiting_network'
  | 'needs_attention'

export type CiiyaSyncDesktopState = {
  appVersion: string
  releaseChannel: 'development' | 'canary' | 'stable'
  platform: CiiyaSyncDesktopPlatform
  connected: boolean
  deviceId: string | null
  ownerId: string | null
  tokenExpiresAt: string | null
  settings: CiiyaSyncDesktopSettings
  pairing: CiiyaSyncPairingState
  albums: CiiyaSyncDesktopAlbum[]
  albumsLoading: boolean
  sync: {
    running: boolean
    message: string
    lastError: string | null
  }
  session: {
    active: boolean
    status: CiiyaSyncDesktopLiveStatus
    summary: CiiyaSyncSessionSummary | null
    albumTitle: string | null
    folderName: string | null
    networkOnline: boolean
    networkChangedAt: string
    stateUpdatedAt: string
  }
  lightroom: {
    supported: boolean
    installed: boolean
    pluginPath: string | null
    version: string | null
    bridgeReady: boolean
    bridgeError: string | null
  }
  queue: CiiyaSyncDesktopQueueItem[]
  queueSummary: CiiyaSyncDesktopQueueSummary
}

export type CiiyaSyncDesktopPreferences = {
  albumId?: string | null
  autoStart?: boolean
}

export type CiiyaSyncDesktopBridge = {
  getState(): Promise<CiiyaSyncDesktopState>
  startPairing(): Promise<CiiyaSyncDesktopState>
  disconnect(): Promise<CiiyaSyncDesktopState>
  refreshAlbums(): Promise<CiiyaSyncDesktopState>
  chooseFolder(): Promise<CiiyaSyncDesktopState>
  savePreferences(
    preferences: CiiyaSyncDesktopPreferences
  ): Promise<CiiyaSyncDesktopState>
  startSync(): Promise<CiiyaSyncDesktopState>
  stopSync(): Promise<CiiyaSyncDesktopState>
  installLightroomPlugin(): Promise<CiiyaSyncDesktopState>
  retryItem(itemId: string): Promise<CiiyaSyncDesktopState>
  cancelItem(itemId: string): Promise<CiiyaSyncDesktopState>
  openPairingPage(): Promise<void>
  onState(listener: (state: CiiyaSyncDesktopState) => void): () => void
}
