import { config } from 'dotenv'

config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env')
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

type QueryBuilder = ReturnType<ReturnType<typeof supabase.from>['select']>

function minutesAgo(minutes: number) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString()
}

async function count(
  table: string,
  builder: (query: QueryBuilder) => QueryBuilder
) {
  let query = supabase.from(table).select('*', {
    count: 'exact',
    head: true,
  })

  query = builder(query)

  const { count, error } = await query

  if (error) {
    throw new Error(`[${table}] ${error.message}`)
  }

  return count || 0
}

async function run() {
  console.log('\n==============================')
  console.log('CIIYA SYSTEM HEALTH CHECK')
  console.log('==============================\n')

  const pendingPhotoJobs = await count('photo_jobs', (q) =>
    q.eq('status', 'pending')
  )

  const processingPhotoJobs = await count('photo_jobs', (q) =>
    q.eq('status', 'processing')
  )

  const failedPhotoJobs = await count('photo_jobs', (q) =>
    q.eq('status', 'failed')
  )

  const stalePhotoJobs = await count('photo_jobs', (q) =>
    q.eq('status', 'processing').lt('started_at', minutesAgo(15))
  )

  const pendingFaceJobs = await count('face_jobs', (q) =>
    q.eq('status', 'pending')
  )

  const processingFaceJobs = await count('face_jobs', (q) =>
    q.eq('status', 'processing')
  )

  const failedFaceJobs = await count('face_jobs', (q) =>
    q.eq('status', 'failed')
  )

  const staleFaceJobs = await count('face_jobs', (q) =>
    q.eq('status', 'processing').lt('started_at', minutesAgo(20))
  )

  const offlineWorkers = await count('worker_heartbeats', (q) =>
    q.lt('last_seen_at', minutesAgo(5))
  )

  const processingPhotos = await count('photos', (q) =>
    q.eq('processing_status', 'processing')
  )

  const failedPhotos = await count('photos', (q) =>
    q.eq('processing_status', 'failed')
  )

  const faceFailedPhotos = await count('photos', (q) =>
    q.eq('face_scan_status', 'failed')
  )

  console.log('PHOTO QUEUE')
  console.log('--------------------------------')
  console.log('Pending     :', pendingPhotoJobs)
  console.log('Processing  :', processingPhotoJobs)
  console.log('Failed      :', failedPhotoJobs)
  console.log('Stale       :', stalePhotoJobs)

  console.log('\nFACE QUEUE')
  console.log('--------------------------------')
  console.log('Pending     :', pendingFaceJobs)
  console.log('Processing  :', processingFaceJobs)
  console.log('Failed      :', failedFaceJobs)
  console.log('Stale       :', staleFaceJobs)

  console.log('\nPHOTOS')
  console.log('--------------------------------')
  console.log('Processing  :', processingPhotos)
  console.log('Failed      :', failedPhotos)
  console.log('Face Failed :', faceFailedPhotos)

  console.log('\nWORKERS')
  console.log('--------------------------------')
  console.log('Offline     :', offlineWorkers)

  console.log('\n==============================')

  const hasCriticalIssue =
    stalePhotoJobs > 0 || staleFaceJobs > 0 || offlineWorkers > 0

  console.log(
    hasCriticalIssue ? 'SYSTEM STATUS: WARNING' : 'SYSTEM STATUS: HEALTHY'
  )

  console.log('==============================\n')
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })