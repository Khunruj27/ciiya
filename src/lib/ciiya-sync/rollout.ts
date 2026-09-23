export type CiiyaSyncRolloutMode = 'off' | 'canary' | 'all'

export type CiiyaSyncRolloutDecision = {
  mode: CiiyaSyncRolloutMode
  enabled: boolean
  reason: 'enabled' | 'disabled' | 'not_in_canary'
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function getCiiyaSyncRolloutMode(
  value = process.env.CIIYA_SYNC_ROLLOUT_MODE
): CiiyaSyncRolloutMode {
  const normalized = String(value || 'all')
    .trim()
    .toLowerCase()
  if (normalized === 'all' || normalized === 'canary' || normalized === 'off') {
    return normalized
  }
  return 'off'
}

export function getCiiyaSyncCanaryOwnerIds(
  value = process.env.CIIYA_SYNC_CANARY_OWNER_IDS
) {
  return new Set(
    String(value || '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => UUID_PATTERN.test(entry))
  )
}

export function getCiiyaSyncRolloutDecision(
  ownerId: string,
  options?: { mode?: string; canaryOwnerIds?: string }
): CiiyaSyncRolloutDecision {
  const mode = getCiiyaSyncRolloutMode(options?.mode)
  if (mode === 'all') return { mode, enabled: true, reason: 'enabled' }
  if (mode === 'off') return { mode, enabled: false, reason: 'disabled' }

  const canaryOwnerIds = getCiiyaSyncCanaryOwnerIds(
    options?.canaryOwnerIds
  )
  const enabled = canaryOwnerIds.has(String(ownerId || '').toLowerCase())
  return {
    mode,
    enabled,
    reason: enabled ? 'enabled' : 'not_in_canary',
  }
}
