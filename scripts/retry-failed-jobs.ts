import { config } from 'dotenv'

config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const DRY_RUN = process.env.RETRY_DRY_RUN !== 'false'

const PHOTO_RETRY_LIMIT = Number(
  process.env.RETRY_FAILED_PHOTO_LIMIT || 100
)

const FACE_RETRY_LIMIT = Number(
  process.env.RETRY_FAILED_FACE_LIMIT || 50
)

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env')
}

const supabase = createClient(
  SUPABASE_URL,
  SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
)

async function retryPhotoJobs() {
  const { data, error } = await supabase
    .from('photo_jobs')
    .select('id,photo_id,retry_count,retries,error')
    .eq('status', 'failed')
    .lt('retry_count', 3)
    .order('updated_at', {
      ascending: true,
    })
    .limit(PHOTO_RETRY_LIMIT)

  if (error) {
    throw new Error(error.message)
  }

  const jobs = data || []

  console.log(
    `[RetryFailedJobs] photo_jobs failed=${jobs.length}`
  )

  if (jobs.length === 0) return

  if (DRY_RUN) {
    console.log('[DRY RUN] Skip retry photo jobs')
    return
  }

  const ids = jobs.map((j) => j.id)

  const { error: retryError } = await supabase
    .from('photo_jobs')
    .update({
      status: 'pending',
      progress: 0,
      error: null,
      started_at: null,
      finished_at: null,
      updated_at: new Date().toISOString(),
    })
    .in('id', ids)

  if (retryError) {
    throw new Error(retryError.message)
  }

  const photoIds = jobs
    .map((j) => j.photo_id)
    .filter(Boolean)

  if (photoIds.length > 0) {
    await supabase
      .from('photos')
      .update({
        processing_status: 'pending',
        processing_progress: 0,
        updated_at: new Date().toISOString(),
      })
      .in('id', photoIds)
  }

  console.log(
    `[RetryFailedJobs] retried photo_jobs=${ids.length}`
  )
}

async function retryFaceJobs() {
  const { data, error } = await supabase
    .from('face_jobs')
    .select('id,photo_id,retry_count,retries,error')
    .eq('status', 'failed')
    .lt('retry_count', 3)
    .order('updated_at', {
      ascending: true,
    })
    .limit(FACE_RETRY_LIMIT)

  if (error) {
    throw new Error(error.message)
  }

  const jobs = data || []

  console.log(
    `[RetryFailedJobs] face_jobs failed=${jobs.length}`
  )

  if (jobs.length === 0) return

  if (DRY_RUN) {
    console.log('[DRY RUN] Skip retry face jobs')
    return
  }

  const ids = jobs.map((j) => j.id)

  const { error: retryError } = await supabase
    .from('face_jobs')
    .update({
      status: 'pending',
      progress: 0,
      error: null,
      started_at: null,
      finished_at: null,
      updated_at: new Date().toISOString(),
    })
    .in('id', ids)

  if (retryError) {
    throw new Error(retryError.message)
  }

  const photoIds = jobs
    .map((j) => j.photo_id)
    .filter(Boolean)

  if (photoIds.length > 0) {
    await supabase
      .from('photos')
      .update({
        face_scan_status: 'pending',
        face_scan_progress: 0,
        face_scan_error: null,
        updated_at: new Date().toISOString(),
      })
      .in('id', photoIds)
  }

  console.log(
    `[RetryFailedJobs] retried face_jobs=${ids.length}`
  )
}

async function run() {
  console.log('\n==============================')
  console.log('RETRY FAILED JOBS')
  console.log('==============================')

  console.log('DRY_RUN =', DRY_RUN)

  await retryPhotoJobs()
  await retryFaceJobs()

  console.log('==============================')
  console.log('DONE')
  console.log('==============================\n')
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })