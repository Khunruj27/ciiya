import type { StorageAdapter } from '@/lib/storage/types'
import { ciiyaSyncInstallerKey, findCiiyaSyncInstaller } from './installers'

export async function installerDownloadResponse(params: {
  installerId: string | null
  authenticated: boolean
  rolloutEnabled: boolean
  getStorage: () => { adapter: Pick<StorageAdapter, 'objectExists' | 'getSignedDownloadUrl'>; bucket: string }
}) {
  const json = (body: unknown, status = 200) => Response.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store, max-age=0', 'Referrer-Policy': 'no-referrer' },
  })
  if (!params.authenticated) return json({ code: 'UNAUTHORIZED' }, 401)
  if (!params.rolloutEnabled) return json({ code: 'SYNC_UNAVAILABLE' }, 403)
  const installer = findCiiyaSyncInstaller(params.installerId)
  if (!installer) return json({ code: 'INVALID_INSTALLER' }, 400)

  try {
    const { adapter, bucket } = params.getStorage()
    const ref = { provider: 'r2' as const, bucket, key: ciiyaSyncInstallerKey(installer) }
    const head = await adapter.objectExists(ref)
    if (!head.exists || head.sizeBytes !== installer.bytes) {
      return json({ code: 'INSTALLER_UNAVAILABLE' }, 503)
    }
    // The browser downloads directly from R2, not through a Vercel response body.
    const url = await adapter.getSignedDownloadUrl(ref, {
      expiresInSeconds: 15 * 60,
      downloadName: installer.filename,
    })
    return json({ url })
  } catch {
    // Do not expose storage credentials, SDK errors, or signed URLs in logs.
    return json({ code: 'INSTALLER_UNAVAILABLE' }, 503)
  }
}
