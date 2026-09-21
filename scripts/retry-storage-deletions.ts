import { config } from 'dotenv'

config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import {
  processStorageDeletionJobs,
  recoverStagedStorageDeletionJobs,
} from '../src/lib/storage/deletion-jobs'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing Supabase service environment variables')
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

async function main() {
  const recovered = await recoverStagedStorageDeletionJobs(supabase)
  const result = await processStorageDeletionJobs({
    supabase,
    workerId: `storage-delete-${process.pid}-${crypto.randomUUID()}`,
    limit: 500,
  })

  console.log(
    JSON.stringify({
      task: 'retry-storage-deletions',
      recovered,
      ...result,
    })
  )
}

main().catch((error) => {
  console.error('[retry-storage-deletions] failed:', error)
  process.exit(1)
})
