import crypto from 'node:crypto'
import {
  mkdir,
  open,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import {
  isTerminalCiiyaSyncStatus,
  type CiiyaSyncQueueEvent,
  type CiiyaSyncQueueItem,
  type CiiyaSyncQueueStatus,
} from '../../../src/lib/ciiya-sync/local'

export const CIIYA_SYNC_SESSION_TELEMETRY_VERSION = 1

export type CiiyaSyncSessionEndReason =
  | 'paused'
  | 'shutdown'
  | 'disconnected'
  | 'replaced'
  | 'interrupted'

type TrackedQueueItem = {
  status: CiiyaSyncQueueStatus
  fileSizeBytes: number
}

type ActiveSession = {
  id: string
  albumId: string
  startedAt: string
  lastActivityAt: string
  items: Record<string, TrackedQueueItem>
}

export type CiiyaSyncSessionSummary = {
  id: string
  albumId: string
  startedAt: string
  endedAt: string | null
  endReason: CiiyaSyncSessionEndReason | null
  lastActivityAt: string
  discoveredCount: number
  queuedCount: number
  activeCount: number
  completedCount: number
  duplicateCount: number
  retryCount: number
  failedCount: number
  cancelledCount: number
  bytesCompleted: number
}

type SessionTelemetryState = {
  version: typeof CIIYA_SYNC_SESSION_TELEMETRY_VERSION
  updatedAt: string
  active: ActiveSession | null
  history: CiiyaSyncSessionSummary[]
}

type StartSessionInput = {
  albumId: string
  queueItems?: CiiyaSyncQueueItem[]
}

const ACTIVE_STATUSES = new Set<CiiyaSyncQueueStatus>([
  'hashing',
  'reserving',
  'uploading',
  'finalizing',
])

function emptyState(): SessionTelemetryState {
  return {
    version: CIIYA_SYNC_SESSION_TELEMETRY_VERSION,
    updatedAt: new Date().toISOString(),
    active: null,
    history: [],
  }
}

function summarize(
  session: ActiveSession,
  endedAt: string | null,
  endReason: CiiyaSyncSessionEndReason | null
): CiiyaSyncSessionSummary {
  const items = Object.values(session.items)
  const count = (status: CiiyaSyncQueueStatus) =>
    items.filter((item) => item.status === status).length

  return {
    id: session.id,
    albumId: session.albumId,
    startedAt: session.startedAt,
    endedAt,
    endReason,
    lastActivityAt: session.lastActivityAt,
    discoveredCount: items.length,
    queuedCount: count('queued'),
    activeCount: items.filter((item) => ACTIVE_STATUSES.has(item.status)).length,
    completedCount: count('completed'),
    duplicateCount: count('duplicate'),
    retryCount: count('retry_wait'),
    failedCount: count('failed'),
    cancelledCount: count('cancelled'),
    bytesCompleted: items
      .filter((item) => item.status === 'completed')
      .reduce((total, item) => total + item.fileSizeBytes, 0),
  }
}

function isSummary(value: unknown): value is CiiyaSyncSessionSummary {
  if (!value || typeof value !== 'object') return false
  const summary = value as Partial<CiiyaSyncSessionSummary>
  return Boolean(summary.id && summary.albumId && summary.startedAt)
}

function isActive(value: unknown): value is ActiveSession {
  if (!value || typeof value !== 'object') return false
  const active = value as Partial<ActiveSession>
  return Boolean(
    active.id &&
      active.albumId &&
      active.startedAt &&
      active.lastActivityAt &&
      active.items &&
      typeof active.items === 'object'
  )
}

function parseState(serialized: string): SessionTelemetryState {
  const parsed = JSON.parse(serialized) as Partial<SessionTelemetryState>
  if (
    parsed.version !== CIIYA_SYNC_SESSION_TELEMETRY_VERSION ||
    !Array.isArray(parsed.history) ||
    parsed.history.some((entry) => !isSummary(entry)) ||
    (parsed.active !== null && parsed.active !== undefined && !isActive(parsed.active))
  ) {
    throw new Error('Unsupported or invalid Ciiya Sync session telemetry')
  }

  return {
    version: CIIYA_SYNC_SESSION_TELEMETRY_VERSION,
    updatedAt: String(parsed.updatedAt || new Date().toISOString()),
    active: parsed.active || null,
    history: parsed.history.slice(0, 20),
  }
}

async function atomicWrite(filePath: string, contents: string) {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`
  await writeFile(temporaryPath, contents, { encoding: 'utf8', mode: 0o600 })
  const handle = await open(temporaryPath, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporaryPath, filePath)
}

export class CiiyaSyncSessionTelemetryStore {
  private state = emptyState()
  private initialization: Promise<void> | null = null
  private operation = Promise.resolve()

  constructor(readonly filePath: string) {
    this.filePath = path.resolve(filePath)
  }

  async initialize() {
    if (!this.initialization) this.initialization = this.load()
    await this.initialization
  }

  async startSession(input: StartSessionInput) {
    await this.initialize()
    return this.runExclusive(async () => {
      if (this.state.active) this.finishActive('replaced')

      const now = new Date().toISOString()
      const items: Record<string, TrackedQueueItem> = {}
      for (const item of input.queueItems || []) {
        if (
          item.albumId === input.albumId &&
          item.source === 'ciiya-sync-live-folder' &&
          !isTerminalCiiyaSyncStatus(item.status)
        ) {
          items[item.id] = {
            status: item.status,
            fileSizeBytes: item.fileSizeBytes,
          }
        }
      }

      this.state.active = {
        id: crypto.randomUUID(),
        albumId: input.albumId,
        startedAt: now,
        lastActivityAt: now,
        items,
      }
      await this.persist()
      return this.snapshotUnsafe()
    })
  }

  async stopSession(reason: CiiyaSyncSessionEndReason) {
    await this.initialize()
    return this.runExclusive(async () => {
      if (this.state.active) {
        this.finishActive(reason)
        await this.persist()
      }
      return this.snapshotUnsafe()
    })
  }

  async recoverInterrupted() {
    await this.initialize()
    return this.runExclusive(async () => {
      if (!this.state.active) return false
      this.finishActive('interrupted')
      await this.persist()
      return true
    })
  }

  async recordQueueEvent(event: CiiyaSyncQueueEvent) {
    await this.initialize()
    if (event.type !== 'enqueued' && event.type !== 'updated') return false

    return this.runExclusive(async () => {
      const active = this.state.active
      const item = event.item
      if (
        !active ||
        item.albumId !== active.albumId ||
        item.source !== 'ciiya-sync-live-folder'
      ) {
        return false
      }

      const previous = active.items[item.id]
      if (
        previous?.status === item.status &&
        previous.fileSizeBytes === item.fileSizeBytes
      ) {
        return false
      }

      active.items[item.id] = {
        status: item.status,
        fileSizeBytes: item.fileSizeBytes,
      }
      active.lastActivityAt = item.updatedAt || new Date().toISOString()
      await this.persist()
      return true
    })
  }

  async snapshot() {
    await this.initialize()
    return structuredClone(this.snapshotUnsafe())
  }

  private snapshotUnsafe() {
    if (this.state.active) {
      return {
        active: true,
        summary: summarize(this.state.active, null, null),
      }
    }
    return {
      active: false,
      summary: this.state.history[0] || null,
    }
  }

  private finishActive(reason: CiiyaSyncSessionEndReason) {
    const active = this.state.active
    if (!active) return
    const endedAt = new Date().toISOString()
    this.state.history.unshift(summarize(active, endedAt, reason))
    this.state.history = this.state.history.slice(0, 20)
    this.state.active = null
  }

  private async load() {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    try {
      this.state = parseState(await readFile(this.filePath, 'utf8'))
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code
      if (code !== 'ENOENT') {
        try {
          await rename(this.filePath, `${this.filePath}.corrupt-${Date.now()}`)
        } catch {
          // Preserve the original when quarantine is unavailable.
        }
      }
      this.state = emptyState()
      await this.persist()
    }
  }

  private async persist() {
    this.state.updatedAt = new Date().toISOString()
    await atomicWrite(
      this.filePath,
      `${JSON.stringify(this.state, null, 2)}\n`
    )
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operation.then(operation, operation)
    this.operation = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}
