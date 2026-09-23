import crypto from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import type {
  CiiyaSyncQueueItem,
  CiiyaSyncReservation,
} from './types'

type FetchImplementation = typeof fetch

type SignedReservation = CiiyaSyncReservation & {
  uploadUrl: string
  method: 'PUT'
  headers: Record<string, string>
}

type UploadResponse = {
  success?: boolean
  duplicate?: boolean
  code?: string
  error?: string
  photoId?: string
  publicUrl?: string | null
  thumbnailUrl?: string | null
  processingStatus?: string | null
  provider?: 'r2'
  bucket?: string
  storagePath?: string
  uploadSessionId?: string
  uploadUrl?: string
  method?: 'PUT'
  headers?: Record<string, string>
  expiresAt?: string | null
  fileHash?: string
  cleanupSafe?: boolean
  jobError?: string | null
}

export type CiiyaSyncUploadOutcome = {
  duplicate: boolean
  photoId: string | null
  processingStatus: string | null
}

export type CiiyaSyncUploadHooks = {
  onHashing?: () => void | Promise<void>
  onHashed?: (fileHash: string) => void | Promise<void>
  onReserving?: () => void | Promise<void>
  onReserved?: (reservation: CiiyaSyncReservation) => void | Promise<void>
  onUploading?: () => void | Promise<void>
  onObjectUploaded?: (uploadedAt: string) => void | Promise<void>
  onFinalizing?: () => void | Promise<void>
}

export class CiiyaSyncHttpError extends Error {
  readonly status: number
  readonly code: string
  readonly retryable: boolean
  readonly retryAfterMs: number | null
  readonly resetReservation: boolean

  constructor(params: {
    message: string
    status?: number
    code?: string | null
    retryable?: boolean
    retryAfterMs?: number | null
    resetReservation?: boolean
  }) {
    super(params.message)
    this.name = 'CiiyaSyncHttpError'
    this.status = params.status || 0
    this.code = params.code || 'SYNC_UPLOAD_FAILED'
    this.retryable = params.retryable === true
    this.retryAfterMs = params.retryAfterMs || null
    this.resetReservation = params.resetReservation === true
  }
}

export class CiiyaSyncSourceChangedError extends Error {
  readonly code = 'SOURCE_CHANGED'

  constructor() {
    super('The source file changed while Ciiya Sync was reading it')
    this.name = 'CiiyaSyncSourceChangedError'
  }
}

function parseRetryAfter(value: string | null) {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

function isResettableSessionCode(code: string | null | undefined) {
  return (
    code === 'UPLOAD_SESSION_EXPIRED' ||
    code === 'UPLOAD_SESSION_NOT_FOUND' ||
    code === 'UPLOAD_SESSION_NOT_FINALIZABLE'
  )
}

async function responseJson(response: Response): Promise<UploadResponse> {
  return (await response.json().catch(() => null)) || {}
}

function normalizeBaseUrl(value: string) {
  const url = new URL(value)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Ciiya Sync API URL must use HTTP or HTTPS')
  }
  return url.toString().replace(/\/$/, '')
}

export class CiiyaSyncUploadClient {
  readonly baseUrl: string

  private fetchImplementation: FetchImplementation
  private requestTimeoutMs: number

  constructor(params: {
    baseUrl: string
    deviceToken: string
    fetchImplementation?: FetchImplementation
    requestTimeoutMs?: number
  }) {
    if (!/^ciiya_sync_[A-Za-z0-9_-]{43}$/.test(params.deviceToken)) {
      throw new Error('Invalid Ciiya Sync device token')
    }

    this.baseUrl = normalizeBaseUrl(params.baseUrl)
    this.deviceToken = params.deviceToken
    this.fetchImplementation = params.fetchImplementation || fetch
    this.requestTimeoutMs = Math.max(5_000, params.requestTimeoutMs || 60_000)
  }

  private readonly deviceToken: string

  async process(
    item: CiiyaSyncQueueItem,
    hooks: CiiyaSyncUploadHooks = {},
    signal?: AbortSignal
  ): Promise<CiiyaSyncUploadOutcome> {
    let fileHash = item.fileHash

    if (!fileHash) {
      await hooks.onHashing?.()
      fileHash = await this.hashStableFile(item, signal)
      await hooks.onHashed?.(fileHash)
    }

    if (item.objectUploadedAt && item.reservation) {
      await hooks.onFinalizing?.()
      return this.finalize(item, item.reservation, signal)
    }

    await hooks.onReserving?.()
    const reserved = await this.reserve(item, fileHash, signal)

    if ('outcome' in reserved) return reserved.outcome

    await hooks.onReserved?.({
      provider: reserved.provider,
      bucket: reserved.bucket,
      storagePath: reserved.storagePath,
      uploadSessionId: reserved.uploadSessionId,
      fileHash: reserved.fileHash,
      expiresAt: reserved.expiresAt,
    })

    await hooks.onUploading?.()
    try {
      await this.assertSourceMatches(item)
      await this.putObject(item.sourcePath, reserved, signal)
      await this.assertSourceMatches(item)
    } catch (error) {
      if (error instanceof CiiyaSyncSourceChangedError) {
        await this.cancelReservation(reserved.uploadSessionId, signal)
      }
      throw error
    }
    const uploadedAt = new Date().toISOString()
    await hooks.onObjectUploaded?.(uploadedAt)

    await hooks.onFinalizing?.()
    return this.finalize(item, reserved, signal)
  }

  async cancelReservation(uploadSessionId: string, signal?: AbortSignal) {
    try {
      await this.request(
        '/api/photos/upload-url',
        {
          method: 'DELETE',
          headers: this.jsonHeaders(),
          body: JSON.stringify({ uploadSessionId }),
        },
        signal
      )
    } catch {
      // Reservations expire and consistency cleanup handles abandoned objects.
    }
  }

  private async hashStableFile(item: CiiyaSyncQueueItem, signal?: AbortSignal) {
    const before = await stat(item.sourcePath)
    if (
      before.size !== item.fileSizeBytes ||
      Math.trunc(before.mtimeMs) !== Math.trunc(item.lastModifiedMs)
    ) {
      throw new CiiyaSyncSourceChangedError()
    }

    const hash = crypto.createHash('sha256')
    const stream = createReadStream(item.sourcePath)
    const onAbort = () => stream.destroy(new Error('Upload cancelled'))
    signal?.addEventListener('abort', onAbort, { once: true })

    try {
      for await (const chunk of stream) {
        if (signal?.aborted) throw new Error('Upload cancelled')
        hash.update(chunk as Buffer)
      }
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }

    const after = await stat(item.sourcePath)
    if (
      after.size !== before.size ||
      Math.trunc(after.mtimeMs) !== Math.trunc(before.mtimeMs)
    ) {
      throw new CiiyaSyncSourceChangedError()
    }

    return hash.digest('hex')
  }

  private async assertSourceMatches(item: CiiyaSyncQueueItem) {
    const current = await stat(item.sourcePath)
    if (
      current.size !== item.fileSizeBytes ||
      Math.trunc(current.mtimeMs) !== Math.trunc(item.lastModifiedMs)
    ) {
      throw new CiiyaSyncSourceChangedError()
    }
  }

  private async reserve(
    item: CiiyaSyncQueueItem,
    fileHash: string,
    signal?: AbortSignal
  ): Promise<SignedReservation | { outcome: CiiyaSyncUploadOutcome }> {
    const response = await this.request(
      '/api/photos/upload-url',
      {
        method: 'POST',
        headers: this.jsonHeaders(),
        body: JSON.stringify({
          albumId: item.albumId,
          clientUploadId: item.clientUploadId,
          fileName: item.fileName,
          contentType: item.contentType,
          fileSizeBytes: item.fileSizeBytes,
          lastModified: item.lastModifiedMs,
          fileHash,
          size: item.requestedSize,
          categoryId: item.categoryId,
          autoFaceScan: item.autoFaceScan,
          autoPublish: item.autoPublish,
        }),
      },
      signal
    )
    const data = await responseJson(response)

    if (data.duplicate) {
      return {
        outcome: {
          duplicate: true,
          photoId: data.photoId || null,
          processingStatus: data.processingStatus || null,
        },
      }
    }

    if (!response.ok || !data.success) {
      throw this.responseError(response, data, 'Unable to reserve upload')
    }

    if (
      data.provider !== 'r2' ||
      !data.bucket ||
      !data.storagePath ||
      !data.uploadSessionId ||
      !data.uploadUrl ||
      data.method !== 'PUT' ||
      !data.headers ||
      !data.fileHash
    ) {
      throw new CiiyaSyncHttpError({
        message: 'Invalid signed upload response',
        code: 'INVALID_UPLOAD_RESPONSE',
      })
    }

    return {
      provider: 'r2',
      bucket: data.bucket,
      storagePath: data.storagePath,
      uploadSessionId: data.uploadSessionId,
      fileHash: data.fileHash,
      expiresAt: data.expiresAt || null,
      uploadUrl: data.uploadUrl,
      method: 'PUT',
      headers: data.headers,
    }
  }

  private async putObject(
    sourcePath: string,
    reservation: SignedReservation,
    signal?: AbortSignal
  ) {
    const stream = createReadStream(sourcePath)
    const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>

    try {
      const response = await this.requestAbsolute(
        reservation.uploadUrl,
        {
          method: reservation.method,
          headers: reservation.headers,
          body,
          // Required by Node fetch for a streamed request body.
          duplex: 'half',
        } as RequestInit & { duplex: 'half' },
        signal,
        Math.max(this.requestTimeoutMs, 15 * 60 * 1000)
      )

      if ((response.status < 200 || response.status >= 300) && response.status !== 412) {
        throw new CiiyaSyncHttpError({
          message: `R2 upload failed (${response.status})`,
          status: response.status,
          code: 'SIGNED_UPLOAD_REJECTED',
          retryable: response.status === 403 || isRetryableStatus(response.status),
          retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
        })
      }
    } catch (error) {
      stream.destroy()
      if (error instanceof CiiyaSyncHttpError) throw error
      throw this.networkError(error)
    }
  }

  private async finalize(
    item: CiiyaSyncQueueItem,
    reservation: CiiyaSyncReservation,
    signal?: AbortSignal
  ) {
    const response = await this.request(
      '/api/photos/finalize-upload',
      {
        method: 'POST',
        headers: this.jsonHeaders(),
        body: JSON.stringify({
          albumId: item.albumId,
          storagePath: reservation.storagePath,
          storageProvider: reservation.provider,
          storageBucket: reservation.bucket,
          uploadSessionId: reservation.uploadSessionId,
          fileName: item.fileName,
          fileHash: reservation.fileHash,
          fileSizeBytes: item.fileSizeBytes,
          size: item.requestedSize,
          categoryId: item.categoryId,
          autoFaceScan: item.autoFaceScan,
          autoPublish: item.autoPublish,
          uploadSource: item.source,
        }),
      },
      signal
    )
    const data = await responseJson(response)

    if (data.duplicate) {
      await this.cancelReservation(reservation.uploadSessionId, signal)
      return {
        duplicate: true,
        photoId: data.photoId || null,
        processingStatus: data.processingStatus || null,
      }
    }

    if (!response.ok || !data.success) {
      const error = this.responseError(response, data, 'Unable to finalize upload')

      if (data.cleanupSafe === true && !error.retryable) {
        await this.cancelReservation(reservation.uploadSessionId, signal)
      }

      throw error
    }

    return {
      duplicate: false,
      photoId: data.photoId || null,
      processingStatus: data.processingStatus || 'pending',
    }
  }

  private jsonHeaders() {
    return {
      Authorization: `Bearer ${this.deviceToken}`,
      'Content-Type': 'application/json',
    }
  }

  private async request(
    pathname: string,
    init: RequestInit,
    signal?: AbortSignal
  ) {
    return this.requestAbsolute(
      `${this.baseUrl}${pathname}`,
      init,
      signal,
      this.requestTimeoutMs
    )
  }

  private async requestAbsolute(
    url: string,
    init: RequestInit,
    signal: AbortSignal | undefined,
    timeoutMs: number
  ) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const onAbort = () => controller.abort()
    signal?.addEventListener('abort', onAbort, { once: true })

    try {
      return await this.fetchImplementation(url, {
        ...init,
        signal: controller.signal,
      })
    } catch (error) {
      if (signal?.aborted) throw error
      throw this.networkError(error)
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
    }
  }

  private responseError(
    response: Response,
    data: UploadResponse,
    fallback: string
  ) {
    const code = data.code || `HTTP_${response.status}`
    return new CiiyaSyncHttpError({
      message: data.error || data.jobError || fallback,
      status: response.status,
      code,
      retryable: isRetryableStatus(response.status) || isResettableSessionCode(code),
      retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
      resetReservation: isResettableSessionCode(code),
    })
  }

  private networkError(error: unknown) {
    if (error instanceof CiiyaSyncHttpError) return error
    const message = error instanceof Error ? error.message : String(error)
    return new CiiyaSyncHttpError({
      message: message || 'Network unavailable',
      code: 'NETWORK_UNAVAILABLE',
      retryable: true,
    })
  }
}
