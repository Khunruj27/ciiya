import path from 'node:path'
import { stat } from 'node:fs/promises'
import { watch, type FSWatcher } from 'chokidar'

export type StablePhoto = {
  sourcePath: string
  fileName: string
  contentType: 'image/jpeg' | 'image/png' | 'image/webp'
  fileSizeBytes: number
  lastModifiedMs: number
}

export type StableFileWatcherOptions = {
  folderPath: string
  stableForMs?: number
  pollIntervalMs?: number
  ignoreInitial?: boolean
  usePolling?: boolean
  onStableFile: (file: StablePhoto) => void | Promise<void>
  onError?: (error: Error) => void
}

type Candidate = {
  timer: ReturnType<typeof setTimeout> | null
  size: number | null
  modifiedMs: number | null
  stableSince: number
}

function photoContentType(filePath: string): StablePhoto['contentType'] | null {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.png') return 'image/png'
  if (extension === '.webp') return 'image/webp'
  return null
}

function shouldIgnore(filePath: string) {
  const base = path.basename(filePath).toLowerCase()
  return (
    base.startsWith('.') ||
    base.endsWith('.tmp') ||
    base.endsWith('.part') ||
    base.endsWith('.crdownload') ||
    base.endsWith('~')
  )
}

export class StableFileWatcher {
  readonly folderPath: string
  readonly stableForMs: number
  readonly pollIntervalMs: number

  private watcher: FSWatcher | null = null
  private candidates = new Map<string, Candidate>()
  private stopped = true

  constructor(private options: StableFileWatcherOptions) {
    this.folderPath = path.resolve(options.folderPath)
    this.stableForMs = Math.max(500, options.stableForMs || 1500)
    this.pollIntervalMs = Math.max(200, options.pollIntervalMs || 500)
  }

  async start() {
    if (this.watcher) return
    const folderStat = await stat(this.folderPath)
    if (!folderStat.isDirectory()) {
      throw new Error('Ciiya Sync watch path must be a directory')
    }
    this.stopped = false

    const watcher = watch(this.folderPath, {
      persistent: true,
      ignoreInitial: this.options.ignoreInitial === true,
      followSymlinks: false,
      depth: 0,
      awaitWriteFinish: false,
      // Lightroom export folders may live on external/network volumes. Polling
      // is more predictable there and avoids exhausting native watch handles.
      usePolling: this.options.usePolling !== false,
      interval: this.pollIntervalMs,
    })

    this.watcher = watcher
    watcher.on('add', (filePath) => this.observe(filePath))
    watcher.on('change', (filePath) => this.observe(filePath))
    watcher.on('unlink', (filePath) => this.removeCandidate(filePath))
    watcher.on('error', (error) => this.report(error))

    await new Promise<void>((resolve, reject) => {
      const onReady = () => {
        watcher.off('error', onInitialError)
        resolve()
      }
      const onInitialError = (error: unknown) => {
        watcher.off('ready', onReady)
        reject(error)
      }

      watcher.once('ready', onReady)
      watcher.once('error', onInitialError)
    })
  }

  async stop() {
    this.stopped = true

    for (const candidate of this.candidates.values()) {
      if (candidate.timer) clearTimeout(candidate.timer)
    }
    this.candidates.clear()

    const watcher = this.watcher
    this.watcher = null
    if (watcher) await watcher.close()
  }

  private observe(filePath: string) {
    const resolvedPath = path.resolve(filePath)
    if (shouldIgnore(resolvedPath) || !photoContentType(resolvedPath)) return

    const previous = this.candidates.get(resolvedPath)
    if (previous?.timer) clearTimeout(previous.timer)

    const candidate: Candidate = {
      timer: null,
      size: previous?.size ?? null,
      modifiedMs: previous?.modifiedMs ?? null,
      stableSince: Date.now(),
    }

    this.candidates.set(resolvedPath, candidate)
    this.scheduleCheck(resolvedPath, candidate)
  }

  private scheduleCheck(filePath: string, candidate: Candidate) {
    if (this.stopped) return
    candidate.timer = setTimeout(
      () => void this.check(filePath, candidate),
      this.pollIntervalMs
    )
  }

  private async check(filePath: string, candidate: Candidate) {
    if (this.stopped || this.candidates.get(filePath) !== candidate) return

    try {
      const fileStat = await stat(filePath)
      if (!fileStat.isFile() || fileStat.size < 1) {
        candidate.stableSince = Date.now()
        this.scheduleCheck(filePath, candidate)
        return
      }

      if (
        candidate.size !== fileStat.size ||
        candidate.modifiedMs !== fileStat.mtimeMs
      ) {
        candidate.size = fileStat.size
        candidate.modifiedMs = fileStat.mtimeMs
        candidate.stableSince = Date.now()
        this.scheduleCheck(filePath, candidate)
        return
      }

      if (Date.now() - candidate.stableSince < this.stableForMs) {
        this.scheduleCheck(filePath, candidate)
        return
      }

      const contentType = photoContentType(filePath)
      this.candidates.delete(filePath)
      if (!contentType) return

      await this.options.onStableFile({
        sourcePath: filePath,
        fileName: path.basename(filePath),
        contentType,
        fileSizeBytes: fileStat.size,
        lastModifiedMs: fileStat.mtimeMs,
      })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code
      this.candidates.delete(filePath)
      if (code !== 'ENOENT') this.report(error)
    }
  }

  private removeCandidate(filePath: string) {
    const resolvedPath = path.resolve(filePath)
    const candidate = this.candidates.get(resolvedPath)
    if (candidate?.timer) clearTimeout(candidate.timer)
    this.candidates.delete(resolvedPath)
  }

  private report(error: unknown) {
    const normalized =
      error instanceof Error ? error : new Error(String(error || 'Watcher error'))
    this.options.onError?.(normalized)
  }
}
