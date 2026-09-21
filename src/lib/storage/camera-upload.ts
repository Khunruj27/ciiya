import { createHash } from 'node:crypto'

import { createStorageRef, photoObjectKey } from './paths'
import type {
  StorageAdapter,
  StorageObjectRef,
  StorageProvider,
} from './types'

export type CameraUploadPlan = {
  provider: StorageProvider
  bucket: string
  key: string
  uploadSessionId: string | null
}

export function hashCameraPhoto(body: Uint8Array) {
  return createHash('sha256').update(body).digest('hex')
}

export function createCameraUploadPlan(params: {
  ownerId: string
  albumId: string
  importId: string
  useR2: boolean
  r2Bucket?: string | null
  existingProvider?: StorageProvider | null
  existingBucket?: string | null
  existingKey?: string | null
  existingUploadSessionId?: string | null
  legacySupabaseKey: string
}): CameraUploadPlan {
  const provider: StorageProvider =
    params.existingProvider === 'r2'
      ? 'r2'
      : params.existingKey
        ? 'supabase'
        : params.useR2
          ? 'r2'
          : 'supabase'

  if (provider === 'r2') {
    const bucket =
      params.existingProvider === 'r2' && params.existingBucket
        ? params.existingBucket
        : params.r2Bucket

    if (!bucket) {
      throw new Error('Missing R2 bucket for camera import')
    }

    return {
      provider,
      bucket,
      key:
        params.existingKey ||
        photoObjectKey({
          ownerId: params.ownerId,
          albumId: params.albumId,
          objectId: params.importId,
          kind: 'original',
          extension: 'jpg',
        }),
      uploadSessionId: params.existingUploadSessionId || null,
    }
  }

  return {
    provider,
    bucket: params.existingBucket || 'albums',
    key: params.existingKey || params.legacySupabaseKey,
    uploadSessionId: null,
  }
}

export async function ensureCameraUploadObject(params: {
  adapter: StorageAdapter
  ref: StorageObjectRef
  body: Uint8Array
  contentType?: string
}) {
  const contentType = params.contentType || 'image/jpeg'
  const existing = await params.adapter.objectExists(params.ref)

  if (existing.exists) {
    if (
      existing.sizeBytes !== null &&
      existing.sizeBytes !== params.body.byteLength
    ) {
      throw new Error('Existing camera object size does not match local file')
    }

    const storedType = String(existing.contentType || '')
      .split(';')[0]
      .trim()
      .toLowerCase()

    if (storedType && storedType !== contentType) {
      throw new Error('Existing camera object type does not match local file')
    }

    return { head: existing, reused: true }
  }

  const head = await params.adapter.uploadObject(
    createStorageRef(params.ref),
    params.body,
    {
      contentType,
      cacheControl: 'private, no-store',
      upsert: false,
    }
  )

  if (head.sizeBytes !== null && head.sizeBytes !== params.body.byteLength) {
    throw new Error('Uploaded camera object size could not be verified')
  }

  return { head, reused: false }
}
