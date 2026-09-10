type ClientErrorEvent = {
  message: string
  name?: string
  stack?: string
  source?: string
  line?: number
  column?: number
  route: string
}

const reported = new Set<string>()

function clean(value: unknown, maxLength: number) {
  return String(value || '').slice(0, maxLength)
}

function sourcePath(value: string | undefined) {
  if (!value) return undefined

  try {
    const url = new URL(value, window.location.origin)
    return url.origin === window.location.origin ? url.pathname : url.origin
  } catch {
    return undefined
  }
}

function reportClientError(event: ClientErrorEvent) {
  if (process.env.NODE_ENV !== 'production') return

  const payload = {
    message: clean(event.message, 600),
    name: clean(event.name, 100),
    stack: clean(event.stack, 2_000),
    source: sourcePath(event.source),
    line: Number.isFinite(event.line) ? event.line : undefined,
    column: Number.isFinite(event.column) ? event.column : undefined,
    route: window.location.pathname.slice(0, 300),
  }
  const signature = `${payload.route}:${payload.name}:${payload.message}:${payload.line || 0}`

  if (reported.has(signature)) return
  reported.add(signature)
  if (reported.size > 50) reported.delete(reported.values().next().value || '')

  try {
    const body = JSON.stringify(payload)
    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        '/api/monitoring/client-error',
        new Blob([body], { type: 'application/json' })
      )
      return
    }

    void fetch('/api/monitoring/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    })
  } catch {
    // Monitoring must never interrupt the user experience.
  }
}

window.addEventListener('error', (event) => {
  reportClientError({
    message: event.message || 'Unhandled client error',
    name: event.error instanceof Error ? event.error.name : 'ErrorEvent',
    stack: event.error instanceof Error ? event.error.stack : undefined,
    source: event.filename,
    line: event.lineno,
    column: event.colno,
    route: window.location.pathname,
  })
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  reportClientError({
    message: reason instanceof Error ? reason.message : clean(reason, 600),
    name: reason instanceof Error ? reason.name : 'UnhandledRejection',
    stack: reason instanceof Error ? reason.stack : undefined,
    route: window.location.pathname,
  })
})
