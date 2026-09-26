import path from 'node:path'
import { stat } from 'node:fs/promises'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  net,
  safeStorage,
  shell,
  Tray,
} from 'electron'
import {
  CiiyaSyncEngine,
  CiiyaSyncQueueStore,
  type CiiyaSyncQueueEvent,
  type CiiyaSyncQueueStatus,
} from '../../../src/lib/ciiya-sync/local'
import { CiiyaSyncDesktopApi } from './api-client'
import {
  CIIYA_SYNC_LIGHTROOM_BRIDGE_PORT,
  CiiyaSyncLightroomBridge,
} from './lightroom-bridge'
import {
  CiiyaSyncBridgeSecretStore,
  CiiyaSyncLightroomPluginInstaller,
  type CiiyaSyncLightroomPluginStatus,
} from './lightroom-plugin'
import {
  type CiiyaSyncDesktopPreferences,
  type CiiyaSyncDesktopLiveStatus,
  type CiiyaSyncDesktopQueueItem,
  type CiiyaSyncDesktopQueueSummary,
  type CiiyaSyncDesktopState,
  type CiiyaSyncPairingState,
} from './contracts'
import { CiiyaSyncSessionTelemetryStore } from './session-telemetry'
import {
  CiiyaSyncCredentialStore,
  CiiyaSyncSettingsStore,
  desktopPlatform,
} from './settings-store'

declare const CIIYA_SYNC_RELEASE_CHANNEL:
  | 'development'
  | 'canary'
  | 'stable'

const CHANNELS = {
  getState: 'ciiya-sync:get-state',
  startPairing: 'ciiya-sync:start-pairing',
  disconnect: 'ciiya-sync:disconnect',
  refreshAlbums: 'ciiya-sync:refresh-albums',
  chooseFolder: 'ciiya-sync:choose-folder',
  savePreferences: 'ciiya-sync:save-preferences',
  startSync: 'ciiya-sync:start-sync',
  stopSync: 'ciiya-sync:stop-sync',
  installLightroomPlugin: 'ciiya-sync:install-lightroom-plugin',
  retryItem: 'ciiya-sync:retry-item',
  cancelItem: 'ciiya-sync:cancel-item',
  openPairingPage: 'ciiya-sync:open-pairing-page',
  stateChanged: 'ciiya-sync:state-changed',
} as const

const QUEUE_STATUSES: CiiyaSyncQueueStatus[] = [
  'queued',
  'hashing',
  'reserving',
  'uploading',
  'finalizing',
  'retry_wait',
  'completed',
  'duplicate',
  'failed',
  'cancelled',
]

function idlePairing(): CiiyaSyncPairingState {
  return {
    status: 'idle',
    userCode: null,
    verificationUriComplete: null,
    expiresAt: null,
    error: null,
  }
}

function queueSummary(
  items: CiiyaSyncDesktopQueueItem[]
): CiiyaSyncDesktopQueueSummary {
  const summary = Object.fromEntries(
    QUEUE_STATUSES.map((status) => [status, 0])
  ) as CiiyaSyncDesktopQueueSummary
  for (const item of items) summary[item.status] += 1
  return summary
}

function toQueueItem(
  item: Awaited<ReturnType<CiiyaSyncQueueStore['list']>>[number]
): CiiyaSyncDesktopQueueItem {
  return {
    id: item.id,
    albumId: item.albumId,
    sourcePath: item.sourcePath,
    fileName: item.fileName,
    fileSizeBytes: item.fileSizeBytes,
    status: item.status,
    attempts: item.attempts,
    nextAttemptAt: item.nextAttemptAt,
    photoId: item.photoId,
    processingStatus: item.processingStatus,
    error: item.error,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    completedAt: item.completedAt,
  }
}

function sleep(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const timeout = setTimeout(resolve, milliseconds)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout)
        reject(signal.reason)
      },
      { once: true }
    )
  })
}

class CiiyaSyncDesktopController {
  private settingsStore: CiiyaSyncSettingsStore
  private credentialStore: CiiyaSyncCredentialStore
  private queueStore: CiiyaSyncQueueStore
  private sessionTelemetry: CiiyaSyncSessionTelemetryStore
  private api: CiiyaSyncDesktopApi | null = null
  private deviceToken: string | null = null
  private albums: CiiyaSyncDesktopState['albums'] = []
  private albumsLoading = false
  private pairing = idlePairing()
  private pairingAbort: AbortController | null = null
  private engine: CiiyaSyncEngine | null = null
  private liveFolderRunning = false
  private lightroomBridge: CiiyaSyncLightroomBridge | null = null
  private lightroomBridgeSecret: string | null = null
  private lightroomBridgeError: string | null = null
  private lightroomPlugin: CiiyaSyncLightroomPluginInstaller
  private lightroomPluginStatus: CiiyaSyncLightroomPluginStatus
  private lightroomSecretStore: CiiyaSyncBridgeSecretStore
  private syncMessage = 'พร้อมตั้งค่า Ciiya Sync'
  private lastError: string | null = null
  private networkOnline = true
  private networkChangedAt = new Date().toISOString()
  private networkMonitor: ReturnType<typeof setInterval> | null = null
  private emitTimer: ReturnType<typeof setTimeout> | null = null
  private albumRefreshTimer: ReturnType<typeof setTimeout> | null = null
  private emitOperation = Promise.resolve<CiiyaSyncDesktopState | null>(null)
  private listeners = new Set<(state: CiiyaSyncDesktopState) => void>()

  constructor(private userDataPath: string) {
    this.settingsStore = new CiiyaSyncSettingsStore(
      path.join(userDataPath, 'settings.json'),
      process.env.CIIYA_SYNC_API_BASE_URL
    )
    this.credentialStore = new CiiyaSyncCredentialStore(
      path.join(userDataPath, 'device-token.bin'),
      {
        isAvailable: () => safeStorage.isEncryptionAvailable(),
        encrypt: (value) => safeStorage.encryptString(value),
        decrypt: (value) => safeStorage.decryptString(Buffer.from(value)),
      }
    )
    this.queueStore = new CiiyaSyncQueueStore(
      path.join(userDataPath, 'queue.json')
    )
    this.sessionTelemetry = new CiiyaSyncSessionTelemetryStore(
      path.join(userDataPath, 'session-telemetry.json')
    )
    this.lightroomPlugin = new CiiyaSyncLightroomPluginInstaller(
      path.join(__dirname, 'lightroom', 'CiiyaSync.lrplugin')
    )
    this.lightroomPluginStatus = {
      supported: process.platform === 'darwin' || process.platform === 'win32',
      installed: false,
      pluginPath: this.lightroomPlugin.destinationPath(),
      version: null,
    }
    this.lightroomSecretStore = new CiiyaSyncBridgeSecretStore(
      path.join(userDataPath, 'lightroom-bridge-secret')
    )
    this.queueStore.subscribe((event) => void this.handleQueueEvent(event))
  }

  async initialize() {
    const settings = await this.settingsStore.load()
    this.api = new CiiyaSyncDesktopApi(settings.apiBaseUrl)
    this.deviceToken = await this.credentialStore.load()
    await this.queueStore.initialize()
    await this.queueStore.recoverInterrupted()
    await this.sessionTelemetry.initialize()
    await this.sessionTelemetry.recoverInterrupted()
    this.startNetworkMonitor()
    await this.initializeLightroomBridge()

    if (this.deviceToken) {
      try {
        await this.refreshAlbums(false)
        this.syncMessage = 'เชื่อมต่อกับ Ciiya แล้ว'
      } catch (error) {
        this.lastError = this.message(error)
      }
    }

    if (
      this.deviceToken &&
      settings.autoStart &&
      settings.folderPath &&
      settings.albumId
    ) {
      try {
        await this.startSync()
      } catch (error) {
        this.lastError = this.message(error)
      }
    } else if (this.deviceToken) {
      try {
        await this.ensureProcessingEngine()
      } catch (error) {
        this.lastError = this.message(error)
      }
    }
    // The renderer may request its first snapshot while albums are still
    // loading. Always publish the completed initialization snapshot so it
    // cannot remain stuck on the transient loading state.
    return this.emit()
  }

  subscribe(listener: (state: CiiyaSyncDesktopState) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async state(): Promise<CiiyaSyncDesktopState> {
    const settings = await this.settingsStore.load()
    const sessionTelemetry = await this.sessionTelemetry.snapshot()
    const allQueueItems = (await this.queueStore.list())
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(toQueueItem)
    const queue = allQueueItems.slice(0, 250)
    const sessionSummary = sessionTelemetry.summary
    const sessionStatus = this.liveStatus(
      sessionTelemetry.active,
      sessionSummary
    )
    return {
      appVersion: app.getVersion(),
      releaseChannel: CIIYA_SYNC_RELEASE_CHANNEL,
      platform: desktopPlatform(),
      connected: Boolean(this.deviceToken),
      deviceId: settings.deviceId,
      ownerId: settings.ownerId,
      tokenExpiresAt: settings.tokenExpiresAt,
      settings,
      pairing: this.pairing,
      albums: this.albums,
      albumsLoading: this.albumsLoading,
      sync: {
        running: this.liveFolderRunning,
        message: this.syncMessage,
        lastError: this.lastError,
      },
      session: {
        active: sessionTelemetry.active,
        status: sessionStatus,
        summary: sessionSummary,
        albumTitle:
          this.albums.find((album) => album.id === sessionSummary?.albumId)
            ?.title || null,
        folderName: settings.folderPath
          ? path.basename(settings.folderPath)
          : null,
        networkOnline: this.networkOnline,
        networkChangedAt: this.networkChangedAt,
        stateUpdatedAt: new Date().toISOString(),
      },
      lightroom: {
        ...this.lightroomPluginStatus,
        bridgeReady: Boolean(this.lightroomBridge?.port),
        bridgeError: this.lightroomBridgeError,
      },
      queue,
      queueSummary: queueSummary(allQueueItems),
    }
  }

  async startPairing() {
    if (this.pairingAbort) this.pairingAbort.abort()
    const controller = new AbortController()
    this.pairingAbort = controller
    this.pairing = { ...idlePairing(), status: 'starting' }
    this.lastError = null
    await this.emit()

    const settings = await this.settingsStore.load()
    const api = this.requireApi()

    try {
      const started = await api.startPairing({
        clientDeviceId: settings.clientDeviceId,
        deviceName: settings.deviceName,
        platform: desktopPlatform(),
        appVersion: app.getVersion(),
      })
      this.pairing = {
        status: 'waiting',
        userCode: started.userCode,
        verificationUriComplete: started.verificationUriComplete,
        expiresAt: started.expiresAt,
        error: null,
      }
      await this.emit()
      await this.openTrustedExternal(started.verificationUriComplete)

      const intervalMs = Math.max(2_000, Math.min(10_000, started.interval * 1000))
      while (!controller.signal.aborted) {
        await sleep(intervalMs, controller.signal)
        const result = await api.pairingStatus(
          {
            pairingId: started.pairingId,
            pollSecret: started.pollSecret,
          },
          controller.signal
        )
        if (!result.paired) continue
        if (!result.deviceToken || !result.deviceId || !result.ownerId) {
          throw new Error('Ciiya did not return complete device credentials')
        }

        await this.credentialStore.save(result.deviceToken)
        this.deviceToken = result.deviceToken
        await this.settingsStore.update({
          deviceId: result.deviceId,
          ownerId: result.ownerId,
          tokenExpiresAt: result.expiresAt || null,
        })
        this.pairing = { ...idlePairing(), status: 'connected' }
        this.syncMessage = 'เชื่อมต่อกับ Ciiya แล้ว'
        this.pairingAbort = null
        await this.refreshAlbums(false)
        await this.ensureProcessingEngine()
        return this.emit()
      }
    } catch (error) {
      if (controller.signal.aborted) return this.state()
      const message = this.message(error)
      const expired = message.includes('EXPIRED') || Date.now() >= Date.parse(startedExpiry(this.pairing))
      this.pairing = {
        ...this.pairing,
        status: expired ? 'expired' : 'error',
        error: message,
      }
      this.lastError = message
      this.pairingAbort = null
      return this.emit()
    }

    return this.state()
  }

  async disconnect() {
    this.pairingAbort?.abort()
    this.pairingAbort = null
    await this.stopEngine()
    this.liveFolderRunning = false
    await this.sessionTelemetry.stopSession('disconnected')
    await this.credentialStore.clear()
    this.deviceToken = null
    this.albums = []
    this.pairing = idlePairing()
    this.syncMessage = 'ยกเลิกการเชื่อมต่อแล้ว'
    this.lastError = null
    await this.settingsStore.update({
      deviceId: null,
      ownerId: null,
      tokenExpiresAt: null,
      autoStart: false,
    })
    return this.emit()
  }

  async refreshAlbums(emit = true) {
    const token = this.requireToken()
    this.albumsLoading = true
    if (emit) await this.emit()
    try {
      this.albums = await this.requireApi().albums(token)
      const settings = await this.settingsStore.load()
      if (
        settings.albumId &&
        !this.albums.some((album) => album.id === settings.albumId)
      ) {
        await this.settingsStore.update({ albumId: null, autoStart: false })
      }
      this.lastError = null
    } catch (error) {
      this.lastError = this.message(error)
      throw error
    } finally {
      this.albumsLoading = false
      if (emit) await this.emit()
    }
    return this.state()
  }

  async chooseFolder(window: BrowserWindow | null) {
    const options = {
      title: 'เลือกโฟลเดอร์ Export จาก Lightroom',
      buttonLabel: 'ใช้โฟลเดอร์นี้',
      properties: ['openDirectory', 'createDirectory'] as Array<
        'openDirectory' | 'createDirectory'
      >,
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    if (!result.canceled && result.filePaths[0]) {
      if (this.liveFolderRunning) await this.stopSync()
      await this.settingsStore.update({
        folderPath: result.filePaths[0],
        autoStart: false,
      })
      this.syncMessage = 'เลือกโฟลเดอร์แล้ว กดเริ่มซิงก์เมื่อพร้อม'
      await this.emit()
    }
    return this.state()
  }

  async savePreferences(preferences: CiiyaSyncDesktopPreferences) {
    if (this.liveFolderRunning) throw new Error('หยุดซิงก์ก่อนเปลี่ยนอัลบั้ม')
    const patch: CiiyaSyncDesktopPreferences = {}
    if ('albumId' in preferences) {
      const albumId = preferences.albumId || null
      if (albumId && !this.albums.some((album) => album.id === albumId)) {
        throw new Error('ไม่พบอัลบั้มที่เลือกในบัญชีนี้')
      }
      patch.albumId = albumId
    }
    if ('autoStart' in preferences) patch.autoStart = preferences.autoStart === true
    await this.settingsStore.update(patch)
    return this.emit()
  }

  async startSync() {
    if (this.liveFolderRunning) return this.state()
    const token = this.requireToken()
    const settings = await this.settingsStore.load()
    if (!settings.albumId) throw new Error('กรุณาเลือกอัลบั้ม')
    if (!settings.folderPath) throw new Error('กรุณาเลือกโฟลเดอร์ Lightroom')
    if (!this.albums.some((album) => album.id === settings.albumId)) {
      await this.refreshAlbums(false)
      if (!this.albums.some((album) => album.id === settings.albumId)) {
        throw new Error('อัลบั้มที่เลือกไม่พร้อมใช้งาน')
      }
    }

    await this.stopEngine()
    const engine = new CiiyaSyncEngine({
      apiBaseUrl: settings.apiBaseUrl,
      deviceToken: token,
      albumId: settings.albumId,
      folderPath: settings.folderPath,
      stateFilePath: this.queueStore.stateFilePath,
      queueStore: this.queueStore,
      source: 'ciiya-sync-live-folder',
      autoFaceScan: true,
      autoPublish: true,
      concurrency: 2,
    })
    await engine.start()
    try {
      await this.sessionTelemetry.startSession({
        albumId: settings.albumId,
        queueItems: await this.queueStore.list(),
      })
    } catch (error) {
      await engine.stop()
      throw error
    }
    this.engine = engine
    this.liveFolderRunning = true
    this.syncMessage = 'กำลังเฝ้าดูโฟลเดอร์ Lightroom'
    this.lastError = null
    await this.settingsStore.update({ autoStart: true })
    return this.emit()
  }

  async stopSync() {
    await this.stopEngine()
    this.liveFolderRunning = false
    await this.sessionTelemetry.stopSession('paused')
    await this.settingsStore.update({ autoStart: false })
    this.syncMessage = 'หยุดซิงก์แล้ว ไฟล์ในเครื่องยังอยู่ครบ'
    if (this.deviceToken) await this.ensureProcessingEngine()
    return this.emit()
  }

  async installLightroomPlugin() {
    if (!this.lightroomBridge?.port || !this.lightroomBridgeSecret) {
      throw new Error(
        this.lightroomBridgeError || 'Lightroom bridge ยังไม่พร้อมใช้งาน'
      )
    }
    this.lightroomPluginStatus = await this.lightroomPlugin.install({
      port: this.lightroomBridge.port,
      secret: this.lightroomBridgeSecret,
    })
    this.syncMessage = 'ติดตั้งปลั๊กอินแล้ว กรุณาเปิด Lightroom Classic ใหม่หนึ่งครั้ง'
    return this.emit()
  }

  async retryItem(itemId: string) {
    this.assertQueueId(itemId)
    const engine = await this.ensureProcessingEngine()
    await engine.retry(itemId)
    return this.emit()
  }

  async cancelItem(itemId: string) {
    this.assertQueueId(itemId)
    const engine = await this.ensureProcessingEngine()
    await engine.cancel(itemId)
    return this.emit()
  }

  async openPairingPage() {
    if (!this.pairing.verificationUriComplete) return
    await this.openTrustedExternal(this.pairing.verificationUriComplete)
  }

  async shutdown() {
    this.pairingAbort?.abort()
    this.pairingAbort = null
    await this.stopEngine()
    this.liveFolderRunning = false
    await this.sessionTelemetry.stopSession('shutdown')
    if (this.networkMonitor) clearInterval(this.networkMonitor)
    this.networkMonitor = null
    if (this.emitTimer) clearTimeout(this.emitTimer)
    this.emitTimer = null
    if (this.albumRefreshTimer) clearTimeout(this.albumRefreshTimer)
    this.albumRefreshTimer = null
    await this.lightroomBridge?.stop()
    this.lightroomBridge = null
  }

  private async initializeLightroomBridge() {
    this.lightroomPluginStatus = await this.lightroomPlugin.status()
    try {
      const secret = await this.lightroomSecretStore.loadOrCreate()
      const bridge = new CiiyaSyncLightroomBridge({
        secret,
        port: CIIYA_SYNC_LIGHTROOM_BRIDGE_PORT,
        albums: async () => {
          this.requireToken()
          await this.refreshAlbums(false)
          return this.albums.map((album) => ({
            id: album.id,
            title: album.title,
            photoCount: album.photoCount,
          }))
        },
        enqueue: (input) => this.enqueueLightroomExport(input),
      })
      await bridge.start()
      this.lightroomBridge = bridge
      this.lightroomBridgeSecret = secret
      this.lightroomBridgeError = null
      this.lightroomPluginStatus = await this.lightroomPlugin.refreshConfig({
        port: bridge.port!,
        secret,
      })
    } catch (error) {
      this.lightroomBridge = null
      this.lightroomBridgeError = this.message(error)
    }
  }

  private async enqueueLightroomExport(input: {
    albumId: string
    sourcePath: string
  }) {
    this.requireToken()
    if (!/^[0-9a-f-]{36}$/i.test(input.albumId)) {
      throw new Error('INVALID_ALBUM')
    }
    if (!this.albums.some((album) => album.id === input.albumId)) {
      await this.refreshAlbums(false)
    }
    if (!this.albums.some((album) => album.id === input.albumId)) {
      throw new Error('ALBUM_NOT_AVAILABLE')
    }

    const sourcePath = input.sourcePath.trim()
    if (
      !sourcePath ||
      sourcePath.length > 4096 ||
      sourcePath.includes('\u0000') ||
      !path.isAbsolute(sourcePath)
    ) {
      throw new Error('INVALID_SOURCE_PATH')
    }
    const sourceStat = await stat(sourcePath)
    if (!sourceStat.isFile() || sourceStat.size < 1) {
      throw new Error('SOURCE_FILE_NOT_READY')
    }
    const extension = path.extname(sourcePath).toLowerCase()
    const contentType =
      extension === '.jpg' || extension === '.jpeg'
        ? 'image/jpeg'
        : extension === '.png'
          ? 'image/png'
          : extension === '.webp'
            ? 'image/webp'
            : null
    if (!contentType) throw new Error('UNSUPPORTED_SOURCE_TYPE')

    const engine = await this.ensureProcessingEngine()
    const result = await engine.enqueueFile(
      {
        sourcePath,
        fileName: path.basename(sourcePath),
        contentType,
        fileSizeBytes: sourceStat.size,
        lastModifiedMs: sourceStat.mtimeMs,
      },
      'ciiya-sync-export-selection',
      input.albumId
    )
    return { id: result.item.id, created: result.created }
  }

  private async ensureProcessingEngine() {
    if (this.engine) return this.engine
    const settings = await this.settingsStore.load()
    const engine = new CiiyaSyncEngine({
      apiBaseUrl: settings.apiBaseUrl,
      deviceToken: this.requireToken(),
      stateFilePath: this.queueStore.stateFilePath,
      queueStore: this.queueStore,
      watchFolder: false,
      autoFaceScan: true,
      autoPublish: true,
      concurrency: 2,
    })
    await engine.start()
    this.engine = engine
    return engine
  }

  private async stopEngine() {
    const engine = this.engine
    this.engine = null
    if (engine) await engine.stop()
  }

  private async emit() {
    if (this.emitTimer) clearTimeout(this.emitTimer)
    this.emitTimer = null
    const operation = this.emitOperation.then(async () => {
      const state = await this.state()
      for (const listener of this.listeners) listener(state)
      return state
    })
    this.emitOperation = operation.then(
      (state) => state,
      () => null
    )
    return operation
  }

  private scheduleEmit(delayMs = 60) {
    if (this.emitTimer) clearTimeout(this.emitTimer)
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null
      void this.emit()
    }, delayMs)
  }

  private async handleQueueEvent(event: CiiyaSyncQueueEvent) {
    try {
      await this.sessionTelemetry.recordQueueEvent(event)
      if (
        event.type === 'updated' &&
        (event.item.status === 'completed' || event.item.status === 'duplicate')
      ) {
        this.scheduleAlbumRefresh()
      }
    } finally {
      this.scheduleEmit()
    }
  }

  private scheduleAlbumRefresh(delayMs = 750) {
    if (this.albumRefreshTimer) clearTimeout(this.albumRefreshTimer)
    this.albumRefreshTimer = setTimeout(() => {
      this.albumRefreshTimer = null
      if (!this.deviceToken) return
      void this.refreshAlbums(false)
        .catch(() => undefined)
        .finally(() => this.scheduleEmit(0))
    }, delayMs)
  }

  private startNetworkMonitor() {
    this.networkOnline = net.isOnline()
    this.networkChangedAt = new Date().toISOString()
    if (this.networkMonitor) clearInterval(this.networkMonitor)
    this.networkMonitor = setInterval(() => {
      const online = net.isOnline()
      if (online === this.networkOnline) return
      this.networkOnline = online
      this.networkChangedAt = new Date().toISOString()
      this.scheduleEmit(0)
    }, 5_000)
  }

  private liveStatus(
    sessionActive: boolean,
    summary: Awaited<ReturnType<CiiyaSyncSessionTelemetryStore['snapshot']>>['summary']
  ): CiiyaSyncDesktopLiveStatus {
    if (!sessionActive || !this.liveFolderRunning) return 'paused'
    if (!this.networkOnline) return 'waiting_network'
    if ((summary?.failedCount || 0) > 0) return 'needs_attention'
    if ((summary?.retryCount || 0) > 0) return 'waiting_network'
    if ((summary?.activeCount || 0) + (summary?.queuedCount || 0) > 0) {
      return 'syncing'
    }
    return 'watching'
  }

  private requireApi() {
    if (!this.api) throw new Error('Ciiya Sync is not initialized')
    return this.api
  }

  private requireToken() {
    if (!this.deviceToken) throw new Error('กรุณาเชื่อมต่อ Ciiya ก่อน')
    return this.deviceToken
  }

  private async openTrustedExternal(value: string) {
    const settings = await this.settingsStore.load()
    const target = new URL(value)
    const expected = new URL(settings.apiBaseUrl)
    if (target.origin !== expected.origin || target.protocol !== expected.protocol) {
      throw new Error('Blocked an untrusted pairing URL')
    }
    await shell.openExternal(target.toString())
  }

  private assertQueueId(itemId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(itemId)) throw new Error('Invalid queue item')
  }

  private message(error: unknown) {
    return error instanceof Error ? error.message : String(error)
  }
}

function startedExpiry(pairing: CiiyaSyncPairingState) {
  return pairing.expiresAt || new Date(0).toISOString()
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let controller: CiiyaSyncDesktopController | null = null
let allowQuit = false
let quitOperation: Promise<void> | null = null

const DESKTOP_SHUTDOWN_DEADLINE_MS = 5_000

async function shutdownForQuit(sync: CiiyaSyncDesktopController) {
  let deadline: ReturnType<typeof setTimeout> | null = null
  try {
    await Promise.race([
      sync.shutdown(),
      new Promise<void>((resolve) => {
        deadline = setTimeout(resolve, DESKTOP_SHUTDOWN_DEADLINE_MS)
      }),
    ])
  } finally {
    if (deadline) clearTimeout(deadline)
  }
}

function showWindow() {
  if (allowQuit) return
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow()
    return
  }
  mainWindow.show()
  mainWindow.focus()
}

function createWindow(showOnReady = true) {
  const window = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 860,
    minHeight: 640,
    backgroundColor: '#f5f1e9',
    title: 'Ciiya Sync',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  window.removeMenu()
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.on('close', (event) => {
    if (allowQuit) return
    event.preventDefault()
    window.hide()
  })
  if (showOnReady) window.once('ready-to-show', () => window.show())
  void window.loadFile(path.join(__dirname, 'renderer/index.html'))
  return window
}

function createTray() {
  const iconPath = path.join(__dirname, 'renderer/tray.svg')
  const image = nativeImage.createFromPath(iconPath)
  image.setTemplateImage(process.platform === 'darwin')
  const nextTray = new Tray(image)
  nextTray.setToolTip('Ciiya Sync')
  nextTray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'เปิด Ciiya Sync', click: showWindow },
      { type: 'separator' },
      { label: 'ออกจากโปรแกรม', click: () => app.quit() },
    ])
  )
  nextTray.on('click', showWindow)
  return nextTray
}

function registerIpc(sync: CiiyaSyncDesktopController) {
  ipcMain.handle(CHANNELS.getState, () => sync.state())
  ipcMain.handle(CHANNELS.startPairing, () => sync.startPairing())
  ipcMain.handle(CHANNELS.disconnect, () => sync.disconnect())
  ipcMain.handle(CHANNELS.refreshAlbums, () => sync.refreshAlbums())
  ipcMain.handle(CHANNELS.chooseFolder, () => sync.chooseFolder(mainWindow))
  ipcMain.handle(
    CHANNELS.savePreferences,
    (_event, preferences: CiiyaSyncDesktopPreferences) =>
      sync.savePreferences(preferences || {})
  )
  ipcMain.handle(CHANNELS.startSync, () => sync.startSync())
  ipcMain.handle(CHANNELS.stopSync, () => sync.stopSync())
  ipcMain.handle(CHANNELS.installLightroomPlugin, () =>
    sync.installLightroomPlugin()
  )
  ipcMain.handle(CHANNELS.retryItem, (_event, itemId: string) =>
    sync.retryItem(String(itemId || ''))
  )
  ipcMain.handle(CHANNELS.cancelItem, (_event, itemId: string) =>
    sync.cancelItem(String(itemId || ''))
  )
  ipcMain.handle(CHANNELS.openPairingPage, () => sync.openPairingPage())
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showWindow)
  app.on('activate', showWindow)
  app.on('window-all-closed', () => undefined)
  app.on('before-quit', (event) => {
    if (allowQuit || !controller) return
    event.preventDefault()
    if (quitOperation) return
    quitOperation = shutdownForQuit(controller)
      .catch((error) => console.error('Ciiya Sync shutdown failed', error))
      .finally(() => {
        allowQuit = true
        app.quit()
      })
  })

  void app.whenReady().then(async () => {
    const smokeTest = process.argv.includes('--ciiya-sync-smoke-test')
    app.setAppUserModelId('co.ciiya.sync')
    controller = new CiiyaSyncDesktopController(app.getPath('userData'))
    registerIpc(controller)
    mainWindow = createWindow(!smokeTest)
    const smokeLoad = smokeTest
      ? new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error('Desktop renderer smoke test timed out')),
            10_000
          )
          mainWindow?.webContents.once('did-finish-load', () => {
            clearTimeout(timeout)
            resolve()
          })
          mainWindow?.webContents.once(
            'did-fail-load',
            (_event, code, description) => {
              clearTimeout(timeout)
              reject(
                new Error(`Desktop renderer failed (${code}): ${description}`)
              )
            }
          )
        })
      : null
    if (!smokeTest) {
      tray = createTray()
      tray.on('double-click', showWindow)
    }
    controller.subscribe((state) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(CHANNELS.stateChanged, state)
      }
    })
    await controller.initialize()

    if (smokeTest) {
      await smokeLoad
      console.log('Ciiya Sync desktop smoke test passed.')
      await controller.shutdown()
      allowQuit = true
      app.quit()
    }
  })
}
