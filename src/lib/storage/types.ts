import type { SupabaseClient } from '@supabase/supabase-js'
import type { S3Client } from '@aws-sdk/client-s3'

export type StorageProvider = 'supabase' | 'r2'

export const STORAGE_MIGRATION_STATUSES = [
  'pending',
  'copying',
  'verifying',
  'completed',
  'failed',
] as const

export type StorageMigrationStatus =
  (typeof STORAGE_MIGRATION_STATUSES)[number]

export type StorageObjectRef = {
  provider: StorageProvider
  bucket: string
  key: string
}

export type StorageObjectHead = {
  exists: boolean
  sizeBytes: number | null
  contentType: string | null
  etag: string | null
  lastModified: Date | null
}

export type StorageUploadBody = Uint8Array | Blob

export type UploadObjectOptions = {
  contentType: string
  cacheControl?: string
  upsert?: boolean
  metadata?: Record<string, string>
}

export type SignedUploadOptions = {
  contentType: string
  contentLength: number
  cacheControl?: string
  expiresInSeconds: number
}

export type SignedDownloadOptions = {
  expiresInSeconds: number
  downloadName?: string
}

export type SignedUpload = {
  url: string
  method: 'PUT'
  headers: Record<string, string>
  expiresAt: Date | null
}

export type DeleteObjectsResult = {
  deleted: StorageObjectRef[]
  failed: Array<{
    ref: StorageObjectRef
    error: string
  }>
}

export type StorageObjectListItem = StorageObjectHead & {
  ref: StorageObjectRef
}

export type ListObjectsOptions = {
  bucket: string
  prefix?: string
  cursor?: string | null
  limit?: number
}

export type ListObjectsResult = {
  objects: StorageObjectListItem[]
  nextCursor: string | null
}

export interface StorageAdapter {
  readonly provider: StorageProvider

  uploadObject(
    ref: StorageObjectRef,
    body: StorageUploadBody,
    options: UploadObjectOptions
  ): Promise<StorageObjectHead>

  downloadObject(ref: StorageObjectRef): Promise<Buffer>

  deleteObject(ref: StorageObjectRef): Promise<void>

  deleteObjects(refs: StorageObjectRef[]): Promise<DeleteObjectsResult>

  objectExists(ref: StorageObjectRef): Promise<StorageObjectHead>

  /**
   * Administrative inventory used by consistency and orphan-cleanup jobs.
   * Application request paths should keep using exact object references and
   * HEAD lookups. The method is optional so older injected test adapters stay
   * source-compatible during the dual-provider rollout.
   */
  listObjects?(
    options: ListObjectsOptions
  ): Promise<ListObjectsResult>

  getSignedUploadUrl(
    ref: StorageObjectRef,
    options: SignedUploadOptions
  ): Promise<SignedUpload>

  getSignedDownloadUrl(
    ref: StorageObjectRef,
    options: SignedDownloadOptions
  ): Promise<string>

  getPublicUrl(ref: StorageObjectRef): string | null
}

export type StorageAdapterDependencies = {
  supabase?: SupabaseClient
  r2Client?: S3Client
}

export class StorageAdapterError extends Error {
  readonly provider: StorageProvider
  readonly operation: string
  readonly cause?: unknown

  constructor(params: {
    provider: StorageProvider
    operation: string
    message: string
    cause?: unknown
  }) {
    super(params.message)
    this.name = 'StorageAdapterError'
    this.provider = params.provider
    this.operation = params.operation
    this.cause = params.cause
  }
}
