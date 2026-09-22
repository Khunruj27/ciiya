import assert from 'node:assert/strict'

import worker from '../cloudflare/r2-media-delivery/worker.js'

const publicKey =
  '11111111-1111-4111-8111-111111111111/' +
  '22222222-2222-4222-8222-222222222222/thumbnail/photo.jpg'

function objectBody(body: Uint8Array, range?: { offset: number; length: number }) {
  return {
    body,
    size: 4,
    range,
    httpEtag: '"test-etag"',
    writeHttpMetadata(headers: Headers) {
      headers.set('Content-Type', 'image/jpeg')
    },
  }
}

let lastGetOptions: Record<string, unknown> | null = null
const env = {
  MEDIA_BUCKET: {
    async head() {
      return objectBody(new Uint8Array())
    },
    async get(_key: string, options: Record<string, unknown>) {
      lastGetOptions = options
      if ('range' in options) {
        return objectBody(new Uint8Array([1, 2]), { offset: 0, length: 2 })
      }

      // R2 can expose a full-object range descriptor even when the request did
      // not contain a Range header. The gateway must still answer with 200.
      return objectBody(new Uint8Array([1, 2, 3, 4]), {
        offset: 0,
        length: 4,
      })
    },
  },
}

async function main() {
  const normal = await worker.fetch(
    new Request(`https://media.example.com/${publicKey}`),
    env
  )
  assert.equal(normal.status, 200)
  assert.equal(normal.headers.get('content-range'), null)
  assert.equal(normal.headers.get('content-length'), '4')
  assert.equal('range' in (lastGetOptions || {}), false)

  const ranged = await worker.fetch(
    new Request(`https://media.example.com/${publicKey}`, {
      headers: { Range: 'bytes=0-1' },
    }),
    env
  )
  assert.equal(ranged.status, 206)
  assert.equal(ranged.headers.get('content-range'), 'bytes 0-1/4')
  assert.equal(ranged.headers.get('content-length'), '2')
  assert.equal('range' in (lastGetOptions || {}), true)

  const privateOriginal = await worker.fetch(
    new Request(
      `https://media.example.com/${publicKey.replace('/thumbnail/', '/original/')}`
    ),
    env
  )
  assert.equal(privateOriginal.status, 404)

  console.log('R2 media delivery worker tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
