import crypto from 'node:crypto'
import path from 'node:path'
import type { Stats } from 'node:fs'
import { stat } from 'node:fs/promises'
import { CiiyaSyncQueueStore } from './queue-store'
import { StableFileWatcher, type StablePhoto } from './stable-file-watcher'
import {
  CiiyaSyncHttpError,
  CiiyaSyncSourceChangedError,
  CiiyaSyncUploadClient,
} from './upload-client'
import {
  ciiyaSyncSourceVersion,
  isTerminalCiiyaSyncStatus,
  type CiiyaSyncQueueError,
  type CiiyaSyncQueueItem,
  type CiiyaSyncRequestedSize,
  type CiiyaSyncUploadSource,
} from './types'

export type CiiyaSyncEngineOptions = {
  apiBaseUrl: string
  deviceToken: string
  albumId?: string
  folderPath?: string
  stateFilePath: string
  queueStore?: CiiyaSyncQueueStore
  watchFolder?: boolean
  source?: CiiyaSyncUploadSource
  requestedSize?: CiiyaSyncRequestedSize
  categoryId?: string | null
  autoFaceScan?: boolean
  autoPublish?: boolean
  concurrency?: number
  stableForMs?: number
  pollIntervalMs?: number
  usePolling?: boolean
  retryBaseMs?: number
  retryMaxMs?: number
  retryJitter?: number
  maxAttempts?: number
  fetchImplementation?: typeof fetch
  onWatcherError?: (error: Error) => void
}

type ActiveUpload = {
  controller: AbortController
  promise: Promise<void>
}

function errorDetails(error: unknown): CiiyaSyncQueueError {
  if (error instanceof CiiyaSyncHttpError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      occurredAt: new Date().toISOString(),
    }
  }

  if (error instanceof CiiyaSyncSourceChangedError) {
    return {
      code: error.code,
      message: error.message,
      retryable: true,
      occurredAt: new Date().toISOString(),
    }
  }

  const nodeError = error as NodeJS.ErrnoException
  return {
    code: nodeError?.code || 'LOCAL_SYNC_ERROR',
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
    occurredAt: new Date().toISOString(),
  }
}

export class CiiyaSyncEngine {
  readonly queue: CiiyaSyncQueueStore
  readonly uploader: CiiyaSyncUploadClient

  private watcher: StableFileWatcher | null
  private active = new Map<string, ActiveUpload>()
  private running = false
  private pumpTimer: ReturnType<typeof setTimeout> | null = null
  private pumping = false
  private concurrency: number
  private retryBaseMs: number
  private retryMaxMs: number
  private retryJitter: number
  private maxAttempts: number

  constructor(private options: CiiyaSyncEngineOptions) {
    this.queue =
      options.queueStore || new CiiyaSyncQueueStore(options.stateFilePath)
    this.uploader = new CiiyaSyncUploadClient({
      baseUrl: options.apiBaseUrl,
      deviceToken: options.deviceToken,
      fetchImplementation: options.fetchImplementation,
    })
    this.concurrency = Math.max(1, Math.min(4, options.concurrency || 2))
    this.retryBaseMs = Math.max(1_000, options.retryBaseMs || 2_000)
    this.retryMaxMs = Math.max(this.retryBaseMs, options.retryMaxMs || 5 * 60_000)
    this.retryJitter = Math.max(0, Math.min(0.5, options.retryJitter ?? 0.2))
    this.maxAttempts = Math.max(0, options.maxAttempts || 0)
    const shouldWatch = options.watchFolder !== false
    if (shouldWatch && (!options.albumId || !options.folderPath)) {
      throw new Error('Album and folder are required for Live Folder sync')
    }
    this.watcher = shouldWatch
      ? new StableFileWatcher({
          folderPath: options.folderPath!,
          stableForMs: options.stableForMs,
          pollIntervalMs: options.pollIntervalMs,
          usePolling: options.usePolling,
          onStableFile: (file) => this.enqueueStableFile(file),
          onError: options.onWatcherError,
        })
      : null
  }

  async start() {
    if (this.running) return
    await this.queue.initialize()
    await this.queue.recoverInterrupted()
    this.running = true

    try {
      await this.watcher?.start()
    } catch (error) {
      this.running = false
      throw error
    }

    this.schedulePump()
  }

  async stop() {
    if (!this.running && this.active.size === 0) return
    this.running = false

    if (this.pumpTimer) clearTimeout(this.pumpTimer)
    this.pumpTimer = null
    await this.watcher?.stop()

    for (const upload of this.active.values()) upload.controller.abort()
    await Promise.allSettled([...this.active.values()].map((entry) => entry.promise))
  }

  async retry(itemId: string) {
    const item = await this.queue.retry(itemId)
    if (item) this.schedulePump()
    return item
  }

  async cancel(itemId: string) {
    const active = this.active.get(itemId)
    active?.controller.abort()

    const item = await this.queue.get(itemId)
    if (item?.reservation) {
      await this.uploader.cancelReservation(item.reservation.uploadSessionId)
    }
    return this.queue.cancel(itemId)
  }

  async enqueueFile(
    file: StablePhoto,
    source?: CiiyaSyncUploadSource,
    albumId?: string
  ) {
    const targetAlbumId = albumId || this.options.albumId
    if (!targetAlbumId) throw new Error('Album is required to enqueue a photo')
    const result = await this.queue.enqueue({
      albumId: targetAlbumId,
      source: source || this.options.source || 'ciiya-sync-live-folder',
      sourcePath: file.sourcePath,
      fileName: file.fileName,
      contentType: file.contentType,
      fileSizeBytes: file.fileSizeBytes,
      lastModifiedMs: file.lastModifiedMs,
      requestedSize: this.options.requestedSize || 'original',
      categoryId: this.options.categoryId || null,
      autoFaceScan: this.options.autoFaceScan !== false,
      autoPublish: this.options.autoPublish === true,
    })

    if (result.created) this.schedulePump()
    return result
  }

  async waitForIdle(timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs

    while (Date.now() < deadline) {
      const items = await this.queue.list()
      const pending = items.some(
        (item) =>
          !isTerminalCiiyaSyncStatus(item.status) &&
          item.status !== 'retry_wait'
      )
      if (!pending && this.active.size === 0) return true
      await new Promise((resolve) => setTimeout(resolve, 25))
    }

    return false
  }

  private async enqueueStableFile(file: StablePhoto) {
    await this.enqueueFile(file)
  }

  private schedulePump(delayMs = 0) {
    if (!this.running) return
    if (this.pumpTimer) clearTimeout(this.pumpTimer)
    this.pumpTimer = setTimeout(() => {
      this.pumpTimer = null
      void this.pump()
    }, Math.max(0, delayMs))
  }

  private async pump() {
    if (!this.running || this.pumping) return
    this.pumping = true

    try {
      const items = await this.queue.list()
      const now = Date.now()
      const ready = items
        .filter((item) => {
          if (this.active.has(item.id) || isTerminalCiiyaSyncStatus(item.status)) {
            return false
          }
          if (item.status === 'retry_wait') {
            return !item.nextAttemptAt || Date.parse(item.nextAttemptAt) <= now
          }
          return item.status === 'queued' || item.status === 'finalizing'
        })
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))

      while (this.active.size < this.concurrency && ready.length > 0) {
        const item = ready.shift()!
        const controller = new AbortController()
        const promise = this.processItem(item, controller.signal).finally(() => {
          this.active.delete(item.id)
          this.schedulePump()
        })
        this.active.set(item.id, { controller, promise })
      }

      if (this.active.size < this.concurrency) {
        const retryTimes = items
          .filter((item) => item.status === 'retry_wait' && item.nextAttemptAt)
          .map((item) => Date.parse(item.nextAttemptAt!))
          .filter((value) => Number.isFinite(value) && value > now)
        if (retryTimes.length > 0) {
          this.schedulePump(Math.max(50, Math.min(...retryTimes) - now))
        }
      }
    } finally {
      this.pumping = false
    }
  }

  private async processItem(item: CiiyaSyncQueueItem, signal: AbortSignal) {
    try {
      const current = await this.refreshChangedSource(item)
      if (!current) return

      const outcome = await this.uploader.process(
        current,
        {
          onHashing: async () => {
            await this.queue.update(current.id, { status: 'hashing' })
          },
          onHashed: async (fileHash) => {
            await this.queue.update(current.id, { fileHash })
          },
          onReserving: async () => {
            await this.queue.update(current.id, { status: 'reserving' })
          },
          onReserved: async (reservation) => {
            await this.queue.update(current.id, { reservation })
          },
          onUploading: async () => {
            await this.queue.update(current.id, { status: 'uploading' })
          },
          onObjectUploaded: async (objectUploadedAt) => {
            await this.queue.update(current.id, { objectUploadedAt })
          },
          onFinalizing: async () => {
            await this.queue.update(current.id, { status: 'finalizing' })
          },
        },
        signal
      )

      const completedAt = new Date().toISOString()
      await this.queue.update(current.id, {
        status: outcome.duplicate ? 'duplicate' : 'completed',
        photoId: outcome.photoId,
        processingStatus: outcome.processingStatus,
        error: null,
        nextAttemptAt: null,
        completedAt,
      })
    } catch (error) {
      if (signal.aborted && !this.running) {
        const latest = await this.queue.get(item.id)
        if (latest && !isTerminalCiiyaSyncStatus(latest.status)) {
          await this.queue.update(item.id, {
            status:
              latest.objectUploadedAt && latest.reservation
                ? 'finalizing'
                : 'queued',
            nextAttemptAt: null,
          })
        }
        return
      }

      if (error instanceof CiiyaSyncSourceChangedError) {
        await this.resetChangedSource(item)
        return
      }

      await this.handleFailure(item.id, error)
    }
  }

  private async refreshChangedSource(item: CiiyaSyncQueueItem) {
    try {
      const fileStat = await stat(item.sourcePath)
      const version = ciiyaSyncSourceVersion({
        fileSizeBytes: fileStat.size,
        lastModifiedMs: fileStat.mtimeMs,
      })
      if (version === item.sourceVersion) return item

      await this.resetChangedSource(item, fileStat)
      return null
    } catch (error) {
      await this.handleFailure(item.id, error)
      return null
    }
  }

  private async resetChangedSource(
    item: CiiyaSyncQueueItem,
    knownStat?: Stats
  ) {
    if (item.reservation) {
      await this.uploader.cancelReservation(item.reservation.uploadSessionId)
    }

    try {
      const fileStat = knownStat || (await stat(item.sourcePath))
      await this.queue.update(item.id, {
        clientUploadId: crypto.randomUUID(),
        sourceVersion: ciiyaSyncSourceVersion({
          fileSizeBytes: fileStat.size,
          lastModifiedMs: fileStat.mtimeMs,
        }),
        fileName: path.basename(item.sourcePath),
        fileSizeBytes: fileStat.size,
        lastModifiedMs: fileStat.mtimeMs,
        fileHash: null,
        status: 'queued',
        attempts: 0,
        nextAttemptAt: null,
        reservation: null,
        objectUploadedAt: null,
        error: null,
      })
      this.schedulePump(Math.max(500, this.options.stableForMs || 1500))
    } catch (error) {
      await this.handleFailure(item.id, error)
    }
  }

  private async handleFailure(itemId: string, error: unknown) {
    const details = errorDetails(error)
    const item = await this.queue.get(itemId)
    if (!item || isTerminalCiiyaSyncStatus(item.status)) return

    const attempts = item.attempts + 1
    const reachedLimit = this.maxAttempts > 0 && attempts >= this.maxAttempts
    const retryable = details.retryable && !reachedLimit

    let reservation = item.reservation
    let objectUploadedAt = item.objectUploadedAt

    if (error instanceof CiiyaSyncHttpError && error.resetReservation) {
      if (reservation) {
        await this.uploader.cancelReservation(reservation.uploadSessionId)
      }
      reservation = null
      objectUploadedAt = null
    }

    if (!retryable) {
      await this.queue.update(itemId, {
        status: 'failed',
        attempts,
        reservation,
        objectUploadedAt,
        nextAttemptAt: null,
        error: { ...details, retryable: false },
      })
      return
    }

    const retryAfterMs =
      error instanceof CiiyaSyncHttpError ? error.retryAfterMs : null
    const delay = retryAfterMs ?? this.retryDelay(attempts)
    const nextAttemptAt = new Date(Date.now() + delay).toISOString()

    await this.queue.update(itemId, {
      status: 'retry_wait',
      attempts,
      reservation,
      objectUploadedAt,
      nextAttemptAt,
      error: details,
    })
    this.schedulePump(delay)
  }

  private retryDelay(attempt: number) {
    const exponential = Math.min(
      this.retryMaxMs,
      this.retryBaseMs * 2 ** Math.max(0, attempt - 1)
    )
    const jitterRange = exponential * this.retryJitter
    return Math.max(
      this.retryBaseMs,
      Math.round(exponential - jitterRange + Math.random() * jitterRange * 2)
    )
  }
}
