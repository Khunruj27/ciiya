import crypto from 'node:crypto'
import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  CIIYA_SYNC_QUEUE_VERSION,
  ciiyaSyncSourceVersion,
  type CiiyaSyncEnqueueInput,
  type CiiyaSyncQueueEvent,
  type CiiyaSyncQueueItem,
  type CiiyaSyncQueueState,
} from './types'

type QueueListener = (event: CiiyaSyncQueueEvent) => void
type QueuePatch =
  | Partial<CiiyaSyncQueueItem>
  | ((item: CiiyaSyncQueueItem) => CiiyaSyncQueueItem)

function emptyState(): CiiyaSyncQueueState {
  return {
    version: CIIYA_SYNC_QUEUE_VERSION,
    updatedAt: new Date().toISOString(),
    items: [],
  }
}

function isQueueItem(value: unknown): value is CiiyaSyncQueueItem {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<CiiyaSyncQueueItem>

  return Boolean(
    item.id &&
      item.clientUploadId &&
      item.albumId &&
      item.sourcePath &&
      item.sourceVersion &&
      item.fileName &&
      item.contentType &&
      item.status &&
      item.createdAt &&
      item.updatedAt
  )
}

function parseState(value: string): CiiyaSyncQueueState {
  const parsed = JSON.parse(value) as Partial<CiiyaSyncQueueState>

  if (
    parsed.version !== CIIYA_SYNC_QUEUE_VERSION ||
    !Array.isArray(parsed.items) ||
    parsed.items.some((item) => !isQueueItem(item))
  ) {
    throw new Error('Unsupported or invalid Ciiya Sync queue state')
  }

  return {
    version: CIIYA_SYNC_QUEUE_VERSION,
    updatedAt: String(parsed.updatedAt || new Date().toISOString()),
    items: parsed.items,
  }
}

function cloneItem(item: CiiyaSyncQueueItem): CiiyaSyncQueueItem {
  return structuredClone(item)
}

export class CiiyaSyncQueueStore {
  readonly stateFilePath: string

  private state = emptyState()
  private initialization: Promise<void> | null = null
  private operation = Promise.resolve()
  private listeners = new Set<QueueListener>()

  constructor(stateFilePath: string) {
    this.stateFilePath = path.resolve(stateFilePath)
  }

  async initialize() {
    if (!this.initialization) {
      this.initialization = this.load()
    }
    await this.initialization
  }

  subscribe(listener: QueueListener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async list() {
    await this.initialize()
    return this.state.items.map(cloneItem)
  }

  async get(itemId: string) {
    await this.initialize()
    const item = this.state.items.find((candidate) => candidate.id === itemId)
    return item ? cloneItem(item) : null
  }

  async enqueue(input: CiiyaSyncEnqueueInput) {
    await this.initialize()

    return this.runExclusive(async () => {
      const sourceVersion = ciiyaSyncSourceVersion(input)
      const sourcePath = path.resolve(input.sourcePath)
      const existing = this.state.items.find(
        (item) =>
          item.albumId === input.albumId &&
          item.sourcePath === sourcePath &&
          item.sourceVersion === sourceVersion
      )

      if (existing) {
        return { item: cloneItem(existing), created: false }
      }

      const now = new Date().toISOString()
      const item: CiiyaSyncQueueItem = {
        id: crypto.randomUUID(),
        clientUploadId: crypto.randomUUID(),
        albumId: input.albumId,
        source: input.source,
        sourcePath,
        sourceVersion,
        fileName: input.fileName,
        contentType: input.contentType,
        fileSizeBytes: input.fileSizeBytes,
        lastModifiedMs: input.lastModifiedMs,
        fileHash: null,
        requestedSize: input.requestedSize || 'original',
        categoryId: input.categoryId || null,
        autoFaceScan: input.autoFaceScan !== false,
        autoPublish: input.autoPublish === true,
        status: 'queued',
        attempts: 0,
        nextAttemptAt: null,
        reservation: null,
        objectUploadedAt: null,
        photoId: null,
        processingStatus: null,
        error: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      }

      this.state.items.push(item)
      await this.persist()
      this.emit({ type: 'enqueued', item: cloneItem(item) })
      return { item: cloneItem(item), created: true }
    })
  }

  async update(itemId: string, patch: QueuePatch) {
    await this.initialize()

    return this.runExclusive(async () => {
      const index = this.state.items.findIndex((item) => item.id === itemId)
      if (index < 0) return null

      const current = this.state.items[index]
      const next =
        typeof patch === 'function'
          ? patch(cloneItem(current))
          : { ...current, ...patch }

      next.id = current.id
      next.clientUploadId = next.clientUploadId || current.clientUploadId
      next.updatedAt = new Date().toISOString()
      this.state.items[index] = next
      await this.persist()
      this.emit({ type: 'updated', item: cloneItem(next) })
      return cloneItem(next)
    })
  }

  async retry(itemId: string) {
    return this.update(itemId, (item) => ({
      ...item,
      status: item.objectUploadedAt && item.reservation ? 'finalizing' : 'queued',
      nextAttemptAt: null,
      error: null,
      completedAt: null,
    }))
  }

  async cancel(itemId: string) {
    return this.update(itemId, {
      status: 'cancelled',
      nextAttemptAt: null,
      completedAt: new Date().toISOString(),
    })
  }

  async remove(itemId: string) {
    await this.initialize()

    return this.runExclusive(async () => {
      const index = this.state.items.findIndex((item) => item.id === itemId)
      if (index < 0) return false
      this.state.items.splice(index, 1)
      await this.persist()
      this.emit({ type: 'removed', itemId })
      return true
    })
  }

  async recoverInterrupted() {
    await this.initialize()

    return this.runExclusive(async () => {
      let recovered = 0
      const now = new Date().toISOString()

      this.state.items = this.state.items.map((item) => {
        if (
          item.status !== 'hashing' &&
          item.status !== 'reserving' &&
          item.status !== 'uploading' &&
          item.status !== 'finalizing'
        ) {
          return item
        }

        recovered += 1
        return {
          ...item,
          status:
            item.objectUploadedAt && item.reservation ? 'finalizing' : 'queued',
          nextAttemptAt: null,
          updatedAt: now,
        }
      })

      if (recovered > 0) {
        await this.persist()
        this.emit({ type: 'recovered', count: recovered })
      }

      return recovered
    })
  }

  private async load() {
    await mkdir(path.dirname(this.stateFilePath), { recursive: true })

    try {
      this.state = parseState(await readFile(this.stateFilePath, 'utf8'))
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code

      if (code !== 'ENOENT') {
        const corruptPath = `${this.stateFilePath}.corrupt-${Date.now()}`
        try {
          await rename(this.stateFilePath, corruptPath)
        } catch {
          // If quarantine fails, preserve the original and continue in memory.
        }
      }

      this.state = emptyState()
      await this.persist()
    }
  }

  private async persist() {
    this.state.updatedAt = new Date().toISOString()
    const temporaryPath = `${this.stateFilePath}.tmp-${process.pid}-${crypto.randomUUID()}`
    const serialized = `${JSON.stringify(this.state, null, 2)}\n`

    await writeFile(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600 })

    const handle = await open(temporaryPath, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }

    await rename(temporaryPath, this.stateFilePath)
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operation.then(operation, operation)
    this.operation = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private emit(event: CiiyaSyncQueueEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // Queue persistence must not fail because a UI listener throws.
      }
    }
  }
}
