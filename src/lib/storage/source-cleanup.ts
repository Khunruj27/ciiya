import {
  planPhotoStorageMigration,
  type PhotoMigrationObjectPlan,
  type PhotoStorageMigrationRow,
} from './migration'
import type {
  DeleteObjectsResult,
  StorageAdapter,
  StorageObjectHead,
  StorageObjectRef,
} from './types'

export type PhotoSourceCleanupRow = PhotoStorageMigrationRow & {
  migration_attempts?: number | string | null
  migration_completed_at?: string | null
  source_cleanup_status?: string | null
  source_cleanup_after?: string | null
  source_cleanup_attempts?: number | string | null
}

export type PhotoSourceCleanupInspection = {
  plan: PhotoMigrationObjectPlan
  targetHead: StorageObjectHead
  sources: Array<{
    ref: StorageObjectRef
    head: StorageObjectHead
  }>
}

export type PhotoSourceCleanupResult = {
  objects: number
  sourceObjectsFound: number
  deleted: number
  failed: DeleteObjectsResult['failed']
}

function requirePositiveSize(head: StorageObjectHead, label: string) {
  const size = Number(head.sizeBytes)
  if (!head.exists || !Number.isSafeInteger(size) || size < 1) {
    throw new Error(`${label} is missing or has no valid Content-Length`)
  }
  return size
}

function uniqueRefs(refs: StorageObjectRef[]) {
  const seen = new Set<string>()
  return refs.filter((ref) => {
    const identity = `${ref.provider}\0${ref.bucket}\0${ref.key}`
    if (seen.has(identity)) return false
    seen.add(identity)
    return true
  })
}

export async function inspectPhotoSourceCleanup(params: {
  photo: PhotoSourceCleanupRow
  targetBucket: string
  sourceAdapter: StorageAdapter
  targetAdapter: StorageAdapter
}): Promise<PhotoSourceCleanupInspection[]> {
  if (params.photo.storage_provider !== 'r2') {
    throw new Error(`Photo ${params.photo.id} is not stored in R2`)
  }
  if (params.photo.migration_status !== 'completed') {
    throw new Error(`Photo ${params.photo.id} migration is not completed`)
  }
  if (Number(params.photo.migration_attempts || 0) < 1) {
    throw new Error(`Photo ${params.photo.id} is R2-native and has no Supabase source cleanup`)
  }
  if (params.photo.storage_bucket !== params.targetBucket) {
    throw new Error(`Photo ${params.photo.id} R2 bucket does not match configuration`)
  }

  const plans = planPhotoStorageMigration(
    { ...params.photo, storage_provider: 'supabase' },
    params.targetBucket
  )
  const inspections: PhotoSourceCleanupInspection[] = []

  for (const plan of plans) {
    const targetHead = await params.targetAdapter.objectExists(plan.target)
    const targetSize = requirePositiveSize(
      targetHead,
      `R2 cleanup target ${plan.key}`
    )

    if (
      plan.expectedSizeBytes !== null &&
      targetSize !== plan.expectedSizeBytes
    ) {
      throw new Error(
        `R2 cleanup target size mismatch for ${plan.key}: expected ${plan.expectedSizeBytes}, got ${targetSize}`
      )
    }

    const sources: PhotoSourceCleanupInspection['sources'] = []
    for (const ref of plan.sourceCandidates) {
      const sourceHead = await params.sourceAdapter.objectExists(ref)
      if (!sourceHead.exists) continue
      const sourceSize = requirePositiveSize(
        sourceHead,
        `Supabase cleanup source ${ref.bucket}/${ref.key}`
      )
      if (sourceSize !== targetSize) {
        throw new Error(
          `Cleanup source/target size mismatch for ${plan.key}: Supabase ${sourceSize}, R2 ${targetSize}`
        )
      }
      sources.push({ ref, head: sourceHead })
    }

    inspections.push({ plan, targetHead, sources })
  }

  return inspections
}

export async function deleteVerifiedPhotoSources(params: {
  photo: PhotoSourceCleanupRow
  targetBucket: string
  sourceAdapter: StorageAdapter
  targetAdapter: StorageAdapter
}): Promise<PhotoSourceCleanupResult> {
  const inspections = await inspectPhotoSourceCleanup(params)
  const sourceRefs = uniqueRefs(
    inspections.flatMap((inspection) =>
      inspection.sources.map((source) => source.ref)
    )
  )

  if (sourceRefs.length === 0) {
    return {
      objects: inspections.length,
      sourceObjectsFound: 0,
      deleted: 0,
      failed: [],
    }
  }

  const deletion = await params.sourceAdapter.deleteObjects(sourceRefs)
  const failures = [...deletion.failed]

  for (const ref of sourceRefs) {
    const head = await params.sourceAdapter.objectExists(ref)
    if (
      head.exists &&
      !failures.some(
        (failure) =>
          failure.ref.bucket === ref.bucket && failure.ref.key === ref.key
      )
    ) {
      failures.push({ ref, error: 'Supabase source still exists after deletion' })
    }
  }

  return {
    objects: inspections.length,
    sourceObjectsFound: sourceRefs.length,
    deleted: sourceRefs.length - failures.length,
    failed: failures,
  }
}
