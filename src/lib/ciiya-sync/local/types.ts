export const CIIYA_SYNC_QUEUE_VERSION = 1

export type CiiyaSyncUploadSource =
  | 'ciiya-sync-live-folder'
  | 'ciiya-sync-export-selection'

export type CiiyaSyncRequestedSize = 'sd' | 'hd' | 'uhd' | 'original'

export type CiiyaSyncQueueStatus =
  | 'queued'
  | 'hashing'
  | 'reserving'
  | 'uploading'
  | 'finalizing'
  | 'retry_wait'
  | 'completed'
  | 'duplicate'
  | 'failed'
  | 'cancelled'

export type CiiyaSyncReservation = {
  provider: 'r2'
  bucket: string
  storagePath: string
  uploadSessionId: string
  fileHash: string
  expiresAt: string | null
}

export type CiiyaSyncQueueError = {
  code: string
  message: string
  retryable: boolean
  occurredAt: string
}

export type CiiyaSyncQueueItem = {
  id: string
  clientUploadId: string
  albumId: string
  source: CiiyaSyncUploadSource
  sourcePath: string
  sourceVersion: string
  fileName: string
  contentType: 'image/jpeg' | 'image/png' | 'image/webp'
  fileSizeBytes: number
  lastModifiedMs: number
  fileHash: string | null
  requestedSize: CiiyaSyncRequestedSize
  categoryId: string | null
  autoFaceScan: boolean
  autoPublish: boolean
  status: CiiyaSyncQueueStatus
  attempts: number
  nextAttemptAt: string | null
  reservation: CiiyaSyncReservation | null
  objectUploadedAt: string | null
  photoId: string | null
  processingStatus: string | null
  error: CiiyaSyncQueueError | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export type CiiyaSyncQueueState = {
  version: typeof CIIYA_SYNC_QUEUE_VERSION
  updatedAt: string
  items: CiiyaSyncQueueItem[]
}

export type CiiyaSyncEnqueueInput = {
  albumId: string
  source: CiiyaSyncUploadSource
  sourcePath: string
  fileName: string
  contentType: CiiyaSyncQueueItem['contentType']
  fileSizeBytes: number
  lastModifiedMs: number
  requestedSize?: CiiyaSyncRequestedSize
  categoryId?: string | null
  autoFaceScan?: boolean
  autoPublish?: boolean
}

export type CiiyaSyncQueueEvent =
  | { type: 'enqueued'; item: CiiyaSyncQueueItem }
  | { type: 'updated'; item: CiiyaSyncQueueItem }
  | { type: 'removed'; itemId: string }
  | { type: 'recovered'; count: number }

export function isTerminalCiiyaSyncStatus(status: CiiyaSyncQueueStatus) {
  return (
    status === 'completed' ||
    status === 'duplicate' ||
    status === 'failed' ||
    status === 'cancelled'
  )
}

export function ciiyaSyncSourceVersion(params: {
  fileSizeBytes: number
  lastModifiedMs: number
}) {
  return `${params.fileSizeBytes}:${Math.trunc(params.lastModifiedMs)}`
}
