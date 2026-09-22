const PUBLIC_FOLDERS = new Set([
  'preview',
  'thumbnail',
  'cover',
  'guest-moments',
])

function normalizeKey(pathname) {
  let key
  try {
    key = decodeURIComponent(pathname.replace(/^\/+/, ''))
  } catch {
    return null
  }

  const lower = key.toLowerCase()
  if (
    !key ||
    key.length > 1024 ||
    key.endsWith('/') ||
    key.includes('\\') ||
    key.includes('//') ||
    key.includes(String.fromCharCode(0)) ||
    lower.includes('%2e') ||
    lower.includes('%2f') ||
    lower.includes('%5c') ||
    key.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    return null
  }

  return key
}

function isPublicKey(key) {
  const parts = key.split('/')
  if (parts.length >= 3 && parts[1] === 'portfolio') return true
  return parts.length >= 4 && PUBLIC_FOLDERS.has(parts[2])
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin')
  const allowedOrigins = new Set([
    'http://localhost:3000',
    'https://ciiya.vercel.app',
  ])

  const headers = new Headers()
  if (origin && allowedOrigins.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Vary', 'Origin')
  }
  headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
  headers.set(
    'Access-Control-Allow-Headers',
    'Content-Type, Range, If-None-Match'
  )
  headers.set(
    'Access-Control-Expose-Headers',
    'ETag, Content-Length, Content-Range'
  )
  headers.set('Access-Control-Max-Age', '3600')
  return headers
}

function errorResponse(request, status, message) {
  const headers = corsHeaders(request)
  headers.set('Cache-Control', 'no-store')
  headers.set('Content-Type', 'text/plain; charset=utf-8')
  return new Response(message, { status, headers })
}

const worker = {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) })
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return errorResponse(request, 405, 'Method not allowed')
    }

    const key = normalizeKey(new URL(request.url).pathname)
    if (!key || !isPublicKey(key)) {
      return errorResponse(request, 404, 'Not found')
    }

    const rangeRequested = request.headers.has('Range')
    const object =
      request.method === 'HEAD'
        ? await env.MEDIA_BUCKET.head(key)
        : await env.MEDIA_BUCKET.get(key, {
            onlyIf: request.headers,
            ...(rangeRequested ? { range: request.headers } : {}),
          })

    if (!object) {
      return errorResponse(request, 404, 'Not found')
    }

    const headers = corsHeaders(request)
    object.writeHttpMetadata(headers)
    headers.set('ETag', object.httpEtag)
    headers.set('Cache-Control', 'public, max-age=31536000, immutable')
    headers.set('X-Content-Type-Options', 'nosniff')

    const partialResponse = rangeRequested && Boolean(object.range)
    if (partialResponse) {
      const offset = object.range.offset ?? 0
      const length = object.range.length ?? object.size
      headers.set(
        'Content-Range',
        `bytes ${offset}-${offset + length - 1}/${object.size}`
      )
      headers.set('Content-Length', String(length))
    } else {
      headers.set('Content-Length', String(object.size))
    }

    if (request.method === 'HEAD') {
      return new Response(null, { status: 200, headers })
    }

    return new Response(object.body, {
      status: partialResponse ? 206 : 200,
      headers,
    })
  },
}

export default worker
