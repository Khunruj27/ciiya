import type { Instrumentation } from 'next'

function clean(value: unknown, maxLength = 800) {
  return String(value || '')
    .replace(/([?&](?:token|code|secret|key)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/bearer\s+[a-z0-9._-]+/gi, 'Bearer [redacted]')
    .slice(0, maxLength)
}

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context
) => {
  const digest =
    error && typeof error === 'object' && 'digest' in error
      ? clean((error as { digest?: unknown }).digest, 160)
      : undefined

  const event = {
    source: 'next-server',
    level: 'error',
    timestamp: new Date().toISOString(),
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown',
    message: clean(error instanceof Error ? error.message : error),
    digest,
    method: clean(request.method, 12),
    route: clean(context.routePath || request.path.split('?')[0], 300),
    routeType: context.routeType,
    routerKind: context.routerKind,
  }

  // Structured logs are searchable in Vercel/Railway immediately, even when
  // no external monitoring provider has been configured yet.
  console.error('[ciiya-monitor]', JSON.stringify(event))

  const webhook = String(process.env.ERROR_MONITORING_WEBHOOK_URL || '').trim()
  if (!webhook.startsWith('https://')) return

  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(2_000),
    })
  } catch (monitoringError) {
    console.warn(
      '[ciiya-monitor] webhook delivery failed:',
      monitoringError instanceof Error ? monitoringError.message : monitoringError
    )
  }
}
