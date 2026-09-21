import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  assertStorageBucket,
  isPublicDeliveryKey,
  normalizeObjectKey,
} from './paths'
import {
  StorageAdapterError,
  type DeleteObjectsResult,
  type ListObjectsOptions,
  type SignedDownloadOptions,
  type SignedUploadOptions,
  type StorageAdapter,
  type StorageObjectHead,
  type StorageObjectListItem,
  type StorageObjectRef,
  type StorageUploadBody,
  type UploadObjectOptions,
} from './types'

const DELETE_CHUNK_SIZE = 100

function getSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

  if (!url || !key) {
    throw new Error('Missing Supabase storage environment variables')
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

function emptyHead(): StorageObjectHead {
  return {
    exists: false,
    sizeBytes: null,
    contentType: null,
    etag: null,
    lastModified: null,
  }
}

function parseDate(value?: string | null) {
  if (!value) return null

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function getStorageErrorStatus(error: unknown) {
  if (!error || typeof error !== 'object') return null

  const candidate = error as {
    status?: number
    originalError?: { status?: number }
  }

  return candidate.status ?? candidate.originalError?.status ?? null
}

function isNotFound(error: unknown) {
  const status = getStorageErrorStatus(error)
  return status === 400 || status === 404
}

function assertSupabaseRef(ref: StorageObjectRef) {
  if (ref.provider !== 'supabase') {
    throw new Error('Supabase adapter received a non-Supabase object')
  }

  return {
    bucket: assertStorageBucket(ref.bucket),
    key: normalizeObjectKey(ref.key),
  }
}

export function createSupabaseStorageAdapter(
  client: SupabaseClient = getSupabaseAdminClient()
): StorageAdapter {
  async function objectExists(
    ref: StorageObjectRef
  ): Promise<StorageObjectHead> {
    const { bucket, key } = assertSupabaseRef(ref)
    const storage = client.storage.from(bucket)
    const infoResult = await storage.info(key)

    if (infoResult.error) {
      if (isNotFound(infoResult.error)) return emptyHead()

      throw new StorageAdapterError({
        provider: 'supabase',
        operation: 'objectExists',
        message: infoResult.error.message || `Unable to inspect ${key}`,
        cause: infoResult.error,
      })
    }

    if (!infoResult.data) {
      throw new StorageAdapterError({
        provider: 'supabase',
        operation: 'objectExists',
        message: `Supabase returned no object metadata for ${key}`,
      })
    }

    const data = infoResult.data

    return {
      exists: true,
      sizeBytes: data.size ?? data.metadata?.size ?? null,
      contentType: data.contentType ?? data.metadata?.mimetype ?? null,
      etag: data.etag ?? data.metadata?.eTag ?? null,
      lastModified: parseDate(
        data.lastModified || data.metadata?.lastModified || data.updatedAt
      ),
    }
  }

  async function uploadObject(
    ref: StorageObjectRef,
    body: StorageUploadBody,
    options: UploadObjectOptions
  ) {
    const { bucket, key } = assertSupabaseRef(ref)
    const result = await client.storage.from(bucket).upload(key, body, {
      contentType: options.contentType,
      cacheControl: options.cacheControl,
      upsert: options.upsert ?? false,
      metadata: options.metadata,
    })

    if (result.error) {
      throw new StorageAdapterError({
        provider: 'supabase',
        operation: 'uploadObject',
        message: result.error.message,
        cause: result.error,
      })
    }

    return objectExists(ref)
  }

  async function downloadObject(ref: StorageObjectRef) {
    const { bucket, key } = assertSupabaseRef(ref)
    const result = await client.storage.from(bucket).download(key)

    if (result.error || !result.data) {
      throw new StorageAdapterError({
        provider: 'supabase',
        operation: 'downloadObject',
        message: result.error?.message || `Unable to download ${key}`,
        cause: result.error,
      })
    }

    return Buffer.from(await result.data.arrayBuffer())
  }

  async function deleteObjects(
    refs: StorageObjectRef[]
  ): Promise<DeleteObjectsResult> {
    const deleted: StorageObjectRef[] = []
    const failed: DeleteObjectsResult['failed'] = []
    const groups = new Map<string, StorageObjectRef[]>()

    for (const ref of refs) {
      try {
        const { bucket } = assertSupabaseRef(ref)
        groups.set(bucket, [...(groups.get(bucket) || []), ref])
      } catch (error) {
        failed.push({
          ref,
          error: error instanceof Error ? error.message : 'Invalid object',
        })
      }
    }

    for (const [bucket, bucketRefs] of groups) {
      for (let index = 0; index < bucketRefs.length; index += DELETE_CHUNK_SIZE) {
        const chunk = bucketRefs.slice(index, index + DELETE_CHUNK_SIZE)
        const result = await client.storage
          .from(bucket)
          .remove(chunk.map((ref) => normalizeObjectKey(ref.key)))

        if (result.error) {
          failed.push(
            ...chunk.map((ref) => ({ ref, error: result.error!.message }))
          )
        } else {
          deleted.push(...chunk)
        }
      }
    }

    return { deleted, failed }
  }

  async function listObjects(options: ListObjectsOptions) {
    const bucket = assertStorageBucket(options.bucket)
    const prefix = options.prefix
      ? normalizeObjectKey(options.prefix.replace(/\/+$/, ''))
      : ''
    const limit = Math.max(1, Math.min(options.limit ?? 1000, 5000))
    const cursorOffset = Number(options.cursor || 0)

    if (!Number.isSafeInteger(cursorOffset) || cursorOffset < 0) {
      throw new Error('Invalid Supabase inventory cursor')
    }

    const discovered: StorageObjectListItem[] = []

    async function scan(folder: string) {
      let offset = 0

      while (true) {
        const result = await client.storage.from(bucket).list(folder, {
          limit: 1000,
          offset,
          sortBy: { column: 'name', order: 'asc' },
        })

        if (result.error) {
          throw new StorageAdapterError({
            provider: 'supabase',
            operation: 'listObjects',
            message: result.error.message,
            cause: result.error,
          })
        }

        const items = result.data || []

        for (const item of items) {
          const key = folder ? `${folder}/${item.name}` : item.name

          if (!item.id && !item.metadata) {
            await scan(key)
            continue
          }

          discovered.push({
            ref: { provider: 'supabase', bucket, key: normalizeObjectKey(key) },
            exists: true,
            sizeBytes: item.metadata?.size ?? null,
            contentType: item.metadata?.mimetype ?? null,
            etag: item.metadata?.eTag ?? null,
            lastModified: parseDate(item.updated_at || item.created_at),
          })
        }

        if (items.length < 1000) break
        offset += items.length
      }
    }

    await scan(prefix)
    discovered.sort((left, right) =>
      left.ref.key.localeCompare(right.ref.key)
    )
    const objects = discovered.slice(cursorOffset, cursorOffset + limit)
    const nextOffset = cursorOffset + objects.length

    return {
      objects,
      nextCursor: nextOffset < discovered.length ? String(nextOffset) : null,
    }
  }

  return {
    provider: 'supabase',
    uploadObject,
    downloadObject,
    objectExists,
    deleteObjects,
    listObjects,
    async deleteObject(ref) {
      const result = await deleteObjects([ref])
      const failure = result.failed[0]

      if (failure) {
        throw new StorageAdapterError({
          provider: 'supabase',
          operation: 'deleteObject',
          message: failure.error,
        })
      }
    },
    async getSignedUploadUrl(
      ref: StorageObjectRef,
      options: SignedUploadOptions
    ) {
      const { bucket, key } = assertSupabaseRef(ref)
      const result = await client.storage
        .from(bucket)
        .createSignedUploadUrl(key, { upsert: false })

      if (result.error || !result.data) {
        throw new StorageAdapterError({
          provider: 'supabase',
          operation: 'getSignedUploadUrl',
          message: result.error?.message || 'Unable to sign upload',
          cause: result.error,
        })
      }

      return {
        url: result.data.signedUrl,
        method: 'PUT' as const,
        headers: {
          'Content-Type': options.contentType,
          'x-upsert': 'false',
          ...(options.cacheControl
            ? { 'Cache-Control': options.cacheControl }
            : {}),
        },
        // Supabase does not return the token expiry in this API response.
        expiresAt: null,
      }
    },
    async getSignedDownloadUrl(
      ref: StorageObjectRef,
      options: SignedDownloadOptions
    ) {
      const { bucket, key } = assertSupabaseRef(ref)
      const result = await client.storage.from(bucket).createSignedUrl(
        key,
        options.expiresInSeconds,
        options.downloadName ? { download: options.downloadName } : undefined
      )

      if (result.error || !result.data) {
        throw new StorageAdapterError({
          provider: 'supabase',
          operation: 'getSignedDownloadUrl',
          message: result.error?.message || 'Unable to sign download',
          cause: result.error,
        })
      }

      return result.data.signedUrl
    },
    getPublicUrl(ref) {
      const { bucket, key } = assertSupabaseRef(ref)

      if (!isPublicDeliveryKey(key)) return null

      return client.storage.from(bucket).getPublicUrl(key).data.publicUrl
    },
  }
}
