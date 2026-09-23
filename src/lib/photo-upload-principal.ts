import type { SupabaseClient } from '@supabase/supabase-js'
import { authenticateCiiyaSyncDevice } from '@/lib/ciiya-sync/server'
import { getCiiyaSyncRolloutDecision } from '@/lib/ciiya-sync/rollout'

export type PhotoUploadPrincipal =
  | {
      kind: 'browser'
      ownerId: string
      deviceId: null
      client: SupabaseClient
    }
  | {
      kind: 'ciiya-sync'
      ownerId: string
      deviceId: string
      client: SupabaseClient
    }

export type PhotoUploadPrincipalResult = {
  principal: PhotoUploadPrincipal | null
  explicitCredential: boolean
  rolloutDisabled: boolean
}

/**
 * Resolve the caller without ever handing a Supabase user session to Ciiya
 * Sync. An Authorization header is treated as an explicit device credential;
 * when it is invalid we do not fall back to a browser cookie.
 */
export async function resolvePhotoUploadPrincipal(params: {
  request: Request
  browserClient: SupabaseClient
}): Promise<PhotoUploadPrincipalResult> {
  const authorization = String(
    params.request.headers.get('authorization') || ''
  ).trim()

  if (authorization) {
    const authenticated = await authenticateCiiyaSyncDevice(
      params.request,
      'photos:upload'
    )

    if (!authenticated) {
      return {
        principal: null,
        explicitCredential: true,
        rolloutDisabled: false,
      }
    }

    const rollout = getCiiyaSyncRolloutDecision(
      authenticated.device.owner_id
    )

    if (!rollout.enabled) {
      return {
        principal: null,
        explicitCredential: true,
        rolloutDisabled: true,
      }
    }

    return {
      principal: {
        kind: 'ciiya-sync',
        ownerId: authenticated.device.owner_id,
        deviceId: authenticated.device.id,
        client: authenticated.admin,
      },
      explicitCredential: true,
      rolloutDisabled: false,
    }
  }

  const {
    data: { user },
    error,
  } = await params.browserClient.auth.getUser()

  if (error || !user) {
    return {
      principal: null,
      explicitCredential: false,
      rolloutDisabled: false,
    }
  }

  return {
    principal: {
      kind: 'browser',
      ownerId: user.id,
      deviceId: null,
      client: params.browserClient,
    },
    explicitCredential: false,
    rolloutDisabled: false,
  }
}
