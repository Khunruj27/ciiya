import crypto from 'node:crypto'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'

export const CIIYA_SYNC_LIGHTROOM_BRIDGE_PORT = 51_673
const MAX_BODY_BYTES = 32 * 1024
const BRIDGE_SHUTDOWN_GRACE_MS = 1_000

export type CiiyaSyncLightroomAlbum = {
  id: string
  title: string
  photoCount: number
}

export type CiiyaSyncLightroomEnqueueInput = {
  albumId: string
  sourcePath: string
}

export type CiiyaSyncLightroomEnqueueResult = {
  id: string
  created: boolean
}

export type CiiyaSyncLightroomBridgeOptions = {
  secret: string
  port?: number
  albums(): Promise<CiiyaSyncLightroomAlbum[]>
  enqueue(
    input: CiiyaSyncLightroomEnqueueInput
  ): Promise<CiiyaSyncLightroomEnqueueResult>
}

function isLoopback(address: string | undefined) {
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1'
  )
}

function sameSecret(expected: string, actual: string) {
  const left = Buffer.from(expected)
  const right = Buffer.from(actual)
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

function write(
  response: ServerResponse,
  status: number,
  body: string,
  contentType = 'text/plain; charset=utf-8'
) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(body)
}

function encodeLine(values: Record<string, string | number | boolean>) {
  return new URLSearchParams(
    Object.entries(values).map(([key, value]) => [key, String(value)])
  ).toString()
}

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > MAX_BODY_BYTES) throw new Error('REQUEST_TOO_LARGE')
    chunks.push(bytes)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export class CiiyaSyncLightroomBridge {
  private server: http.Server | null = null
  private listeningPort: number | null = null

  constructor(private options: CiiyaSyncLightroomBridgeOptions) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(options.secret)) {
      throw new Error('Invalid Lightroom bridge secret')
    }
  }

  get port() {
    return this.listeningPort
  }

  async start() {
    if (this.server && this.listeningPort !== null) return this.listeningPort
    const server = http.createServer((request, response) => {
      void this.handle(request, response)
    })
    server.keepAliveTimeout = 5_000
    server.headersTimeout = 10_000

    await new Promise<void>((resolve, reject) => {
      const fail = (error: Error) => reject(error)
      server.once('error', fail)
      server.listen(this.options.port ?? CIIYA_SYNC_LIGHTROOM_BRIDGE_PORT, '127.0.0.1', () => {
        server.off('error', fail)
        resolve()
      })
    })

    const address = server.address()
    if (!address || typeof address === 'string') {
      server.close()
      throw new Error('Could not resolve Lightroom bridge port')
    }
    this.server = server
    this.listeningPort = address.port
    return address.port
  }

  async stop() {
    const server = this.server
    this.server = null
    this.listeningPort = null
    if (!server) return
    await new Promise<void>((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(forceClose)
        resolve()
      }
      const forceClose = setTimeout(() => {
        // A Lightroom request may still own a keep-alive socket while the user
        // quits Ciiya Sync. Do not let that local connection trap the app in an
        // endless shutdown; queued work is already durable on disk.
        server.closeAllConnections?.()
        finish()
      }, BRIDGE_SHUTDOWN_GRACE_MS)
      forceClose.unref()

      server.close(finish)
      server.closeIdleConnections?.()
    })
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    try {
      if (!isLoopback(request.socket.remoteAddress)) {
        write(response, 403, 'error=LOOPBACK_ONLY\n')
        return
      }
      const secret = String(request.headers['x-ciiya-sync-secret'] || '')
      if (!sameSecret(this.options.secret, secret)) {
        write(response, 401, 'error=INVALID_BRIDGE_SECRET\n')
        return
      }

      const target = new URL(request.url || '/', 'http://127.0.0.1')
      if (request.method === 'GET' && target.pathname === '/v1/albums') {
        const albums = await this.options.albums()
        const lines = [
          encodeLine({ status: 'ok', version: 1 }),
          ...albums.map((album) =>
            encodeLine({
              albumId: album.id,
              title: album.title,
              photoCount: album.photoCount,
            })
          ),
        ]
        write(response, 200, `${lines.join('\n')}\n`)
        return
      }

      if (request.method === 'POST' && target.pathname === '/v1/export/enqueue') {
        if (
          !String(request.headers['content-type'] || '').startsWith(
            'application/x-www-form-urlencoded'
          )
        ) {
          write(response, 415, 'error=UNSUPPORTED_CONTENT_TYPE\n')
          return
        }
        const body = new URLSearchParams(await readBody(request))
        const result = await this.options.enqueue({
          albumId: String(body.get('albumId') || ''),
          sourcePath: String(body.get('sourcePath') || ''),
        })
        write(
          response,
          result.created ? 201 : 200,
          `${encodeLine({ status: 'queued', id: result.id, created: result.created })}\n`
        )
        return
      }

      write(response, 404, 'error=NOT_FOUND\n')
    } catch (error) {
      const code = error instanceof Error ? error.message : 'BRIDGE_ERROR'
      const status = code === 'REQUEST_TOO_LARGE' ? 413 : 400
      write(response, status, `${encodeLine({ error: code })}\n`)
    }
  }
}
