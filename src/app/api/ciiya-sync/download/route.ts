import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getCiiyaSyncRolloutDecision } from '@/lib/ciiya-sync/rollout'
import { installerDownloadResponse } from '@/lib/ciiya-sync/installer-download'
import { getR2Config } from '@/lib/storage/config'
import { createR2StorageAdapter } from '@/lib/storage/r2'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  const authenticated = Boolean(user && !error)
  if (authenticated && user) {
    const rate = await rateLimit(request, {
      bucket: 'ciiya-sync-installer-download', identifier: user.id,
      limit: 20, windowSeconds: 10 * 60,
    })
    if (!rate.allowed) {
      const response = tooManyRequests(rate, 'Too many installer downloads')
      response.headers.set('Cache-Control', 'private, no-store')
      return response
    }
  }
  return installerDownloadResponse({
    installerId: new URL(request.url).searchParams.get('platform'),
    authenticated,
    rolloutEnabled: authenticated && user ? getCiiyaSyncRolloutDecision(user.id).enabled : false,
    getStorage: () => {
      const config = getR2Config()
      return { adapter: createR2StorageAdapter(config), bucket: config.bucketName }
    },
  })
}
