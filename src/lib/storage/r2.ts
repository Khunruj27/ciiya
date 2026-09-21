import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getR2Config, type R2Config } from './config'
import {
  assertStorageBucket,
  encodeObjectKey,
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

const DELETE_CHUNK_SIZE = 1000
const MAX_SIGNED_URL_SECONDS = 7 * 24 * 60 * 60

function createClient(config: R2Config) {
  return new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}

function isNotFound(error: unknown) {
  if (!error || typeof error !== 'object') return false

  const candidate = error as {
    name?: string
    $metadata?: { httpStatusCode?: number }
  }

  return (
    candidate.$metadata?.httpStatusCode === 404 ||
    candidate.name === 'NotFound' ||
    candidate.name === 'NoSuchKey'
  )
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

function sanitizeDownloadName(value: string) {
  const sanitized = value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/["\\]/g, '-')
    .trim()
    .slice(0, 180)

  return sanitized || 'ciiya-download'
}

function assertSignedUrlExpiry(value: number) {
  if (
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_SIGNED_URL_SECONDS
  ) {
    throw new Error('Signed URL expiration must be between 1 and 604800 seconds')
  }

  return value
}

export function createR2StorageAdapter(
  config: R2Config = getR2Config(),
  client: S3Client = createClient(config)
): StorageAdapter {
  const configuredBucket = assertStorageBucket(config.bucketName)

  function assertR2Ref(ref: StorageObjectRef) {
    if (ref.provider !== 'r2') {
      throw new Error('R2 adapter received a non-R2 object')
    }

    const bucket = assertStorageBucket(ref.bucket)

    if (bucket !== configuredBucket) {
      throw new Error('R2 object bucket does not match configured bucket')
    }

    return {
      bucket,
      key: normalizeObjectKey(ref.key),
    }
  }

  async function objectExists(
    ref: StorageObjectRef
  ): Promise<StorageObjectHead> {
    const { bucket, key } = assertR2Ref(ref)

    try {
      const result = await client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key })
      )

      return {
        exists: true,
        sizeBytes: result.ContentLength ?? null,
        contentType: result.ContentType ?? null,
        etag: result.ETag?.replace(/^"|"$/g, '') || null,
        lastModified: result.LastModified || null,
      }
    } catch (error) {
      if (isNotFound(error)) return emptyHead()

      throw new StorageAdapterError({
        provider: 'r2',
        operation: 'objectExists',
        message: error instanceof Error ? error.message : `Unable to inspect ${key}`,
        cause: error,
      })
    }
  }

  async function uploadObject(
    ref: StorageObjectRef,
    body: StorageUploadBody,
    options: UploadObjectOptions
  ) {
    const { bucket, key } = assertR2Ref(ref)

    try {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: options.contentType,
          CacheControl: options.cacheControl,
          Metadata: options.metadata,
          IfNoneMatch: options.upsert ? undefined : '*',
        })
      )

      return objectExists(ref)
    } catch (error) {
      throw new StorageAdapterError({
        provider: 'r2',
        operation: 'uploadObject',
        message: error instanceof Error ? error.message : `Unable to upload ${key}`,
        cause: error,
      })
    }
  }

  async function downloadObject(ref: StorageObjectRef) {
    const { bucket, key } = assertR2Ref(ref)

    try {
      const result = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key })
      )

      if (!result.Body) {
        throw new Error(`Empty object body: ${key}`)
      }

      return Buffer.from(await result.Body.transformToByteArray())
    } catch (error) {
      throw new StorageAdapterError({
        provider: 'r2',
        operation: 'downloadObject',
        message: error instanceof Error ? error.message : `Unable to download ${key}`,
        cause: error,
      })
    }
  }

  async function deleteObjects(
    refs: StorageObjectRef[]
  ): Promise<DeleteObjectsResult> {
    const deleted: StorageObjectRef[] = []
    const failed: DeleteObjectsResult['failed'] = []
    const validRefs: StorageObjectRef[] = []

    for (const ref of refs) {
      try {
        assertR2Ref(ref)
        validRefs.push(ref)
      } catch (error) {
        failed.push({
          ref,
          error: error instanceof Error ? error.message : 'Invalid object',
        })
      }
    }

    for (let index = 0; index < validRefs.length; index += DELETE_CHUNK_SIZE) {
      const chunk = validRefs.slice(index, index + DELETE_CHUNK_SIZE)

      try {
        const result = await client.send(
          new DeleteObjectsCommand({
            Bucket: configuredBucket,
            Delete: {
              Quiet: false,
              Objects: chunk.map((ref) => ({ Key: normalizeObjectKey(ref.key) })),
            },
          })
        )

        const errors = new Map(
          (result.Errors || []).map((error) => [
            error.Key,
            error.Message || error.Code || 'Delete failed',
          ])
        )

        for (const ref of chunk) {
          const error = errors.get(normalizeObjectKey(ref.key))
          if (error) failed.push({ ref, error })
          else deleted.push(ref)
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'R2 batch delete failed'
        failed.push(...chunk.map((ref) => ({ ref, error: message })))
      }
    }

    return { deleted, failed }
  }

  return {
    provider: 'r2',
    uploadObject,
    downloadObject,
    objectExists,
    deleteObjects,
    async listObjects(options: ListObjectsOptions) {
      const bucket = assertStorageBucket(options.bucket)

      if (bucket !== configuredBucket) {
        throw new Error('R2 inventory bucket does not match configured bucket')
      }

      const prefix = options.prefix
        ? `${normalizeObjectKey(options.prefix.replace(/\/+$/, ''))}/`
        : undefined
      const limit = Math.max(1, Math.min(options.limit ?? 1000, 1000))

      try {
        const result = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ContinuationToken: options.cursor || undefined,
            MaxKeys: limit,
          })
        )
        const objects: StorageObjectListItem[] = (result.Contents || [])
          .filter((item): item is typeof item & { Key: string } => Boolean(item.Key))
          .map((item) => ({
            ref: {
              provider: 'r2',
              bucket,
              key: normalizeObjectKey(item.Key),
            },
            exists: true,
            sizeBytes: item.Size ?? null,
            contentType: null,
            etag: item.ETag?.replace(/^"|"$/g, '') || null,
            lastModified: item.LastModified || null,
          }))

        return {
          objects,
          nextCursor: result.IsTruncated
            ? result.NextContinuationToken || null
            : null,
        }
      } catch (error) {
        throw new StorageAdapterError({
          provider: 'r2',
          operation: 'listObjects',
          message:
            error instanceof Error
              ? error.message
              : `Unable to list ${prefix || bucket}`,
          cause: error,
        })
      }
    },
    async deleteObject(ref) {
      const { bucket, key } = assertR2Ref(ref)

      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
      } catch (error) {
        throw new StorageAdapterError({
          provider: 'r2',
          operation: 'deleteObject',
          message: error instanceof Error ? error.message : `Unable to delete ${key}`,
          cause: error,
        })
      }
    },
    async getSignedUploadUrl(
      ref: StorageObjectRef,
      options: SignedUploadOptions
    ) {
      const { bucket, key } = assertR2Ref(ref)

      if (!Number.isSafeInteger(options.contentLength) || options.contentLength < 1) {
        throw new Error('Signed upload content length must be a positive integer')
      }

      const expiresIn = assertSignedUrlExpiry(options.expiresInSeconds)
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: options.contentType,
        ContentLength: options.contentLength,
        CacheControl: options.cacheControl,
        IfNoneMatch: '*',
      })
      const url = await getSignedUrl(client, command, {
        expiresIn,
      })
      const headers: Record<string, string> = {
        'Content-Type': options.contentType,
        'If-None-Match': '*',
      }

      if (options.cacheControl) {
        headers['Cache-Control'] = options.cacheControl
      }

      return {
        url,
        method: 'PUT' as const,
        headers,
        expiresAt: new Date(Date.now() + expiresIn * 1000),
      }
    },
    async getSignedDownloadUrl(
      ref: StorageObjectRef,
      options: SignedDownloadOptions
    ) {
      const { bucket, key } = assertR2Ref(ref)
      const expiresIn = assertSignedUrlExpiry(options.expiresInSeconds)
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ResponseContentDisposition: options.downloadName
          ? `attachment; filename="${sanitizeDownloadName(options.downloadName)}"`
          : undefined,
      })

      return getSignedUrl(client, command, {
        expiresIn,
      })
    },
    getPublicUrl(ref) {
      const { key } = assertR2Ref(ref)

      if (!config.publicBaseUrl || !isPublicDeliveryKey(key)) return null

      return `${config.publicBaseUrl}/${encodeObjectKey(key)}`
    },
  }
}
