import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Actual route handlers, with USB and database access replaced by fixtures.
// No physical device, capture session, account or remote storage is touched.
type Fixture = {
  authenticated: boolean
  ownsAlbum: boolean
  writeError: 'update' | 'insert' | null
  gphotoCalls: number
  operations: Array<{ table: string; operation: string }>
  stdout: string
}

async function main() {
  const fixture: Fixture = {
    authenticated: true, ownsAlbum: true, writeError: null,
    gphotoCalls: 0, operations: [],
    stdout: 'Model                          Port\n----------------------------------------------------------\nCanon EOS Fixture              usb:001,002\n',
  }
  const query = (table: string) => {
    let operation = 'read'
    const result = () => ({
      data: table === 'albums' ? fixture.ownsAlbum ? { id: 'fixture-album', owner_id: 'fixture-user' } : null : { id: 'fixture-session' },
      error: fixture.writeError === operation ? { message: 'fixture write failure' } : null,
    })
    const builder = {
      select() { return builder },
      eq() { return builder },
      order() { return builder },
      limit() { return builder },
      update() { operation = 'update'; fixture.operations.push({ table, operation }); return builder },
      insert() { operation = 'insert'; fixture.operations.push({ table, operation }); return builder },
      async maybeSingle() { return result() },
      async single() { return result() },
      then(resolve: (value: ReturnType<typeof result>) => unknown) { return Promise.resolve(result()).then(resolve) },
    }
    return builder
  }
  const runtime = {
    ...fixture,
    auth: () => ({ data: { user: fixture.authenticated ? { id: 'fixture-user' } : null } }),
    from: query,
    detect: () => { fixture.gphotoCalls++; return { stdout: fixture.stdout, stderr: '' } },
  }
  const built = await build({
    stdin: {
      contents: `export { POST as connect } from './src/app/api/camera/connect/route';
        export { POST as session } from './src/app/api/camera/session/route';
        export { POST as upload } from './src/app/api/camera/upload-session/route';`,
      resolveDir: process.cwd(), loader: 'ts',
    },
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
    plugins: [{ name: 'camera-fixture', setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/supabase-server$/ }, () => ({ path: 'db', namespace: 'camera-fixture' }))
      builder.onResolve({ filter: /^(?:node:)?child_process$/ }, () => ({ path: 'usb', namespace: 'camera-fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'camera-fixture' }, ({ path }) => ({
        contents: path === 'db'
          ? `export async function createServerSupabaseClient() { return { auth: { getUser: fixture.auth }, from: fixture.from }; }`
          : `export function execFile() { throw new Error('Only the promisified fixture may be used'); }
            execFile[Symbol.for('nodejs.util.promisify.custom')] = async () => fixture.detect();`,
      }))
    } }],
  })
  type Handler = (request: Request) => Promise<Response>
  const compiled = { exports: {} as Record<'connect' | 'session' | 'upload', Handler> }
  new Function('require', 'module', 'exports', 'fixture', built.outputFiles[0].text)(
    createRequire(import.meta.url), compiled, compiled.exports, runtime,
  )
  const request = (body = { albumId: 'fixture-album' }) => new Request('https://ciiya.test/api/camera/connect', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const previousEnv = process.env.VERCEL_ENV
  const previousUrl = process.env.VERCEL_URL
  try {
    for (const environment of ['production', 'preview']) {
      process.env.VERCEL_ENV = environment
      for (const handler of Object.values(compiled.exports)) {
        const response = await handler(request())
        assert.equal(response.status, 409)
        assert.match(response.headers.get('Cache-Control') || '', /private.*no-store/)
        assert.deepEqual(await response.json(), {
          error: 'Use Ciiya Sync on your computer to import photos from your camera.',
          code: 'CAMERA_DESKTOP_REQUIRED', connected: false, setupUrl: '/me/ciiya-sync',
        })
      }
    }
    assert.equal(fixture.gphotoCalls, 0, 'Hosted requests must never attempt server USB access')
    assert.deepEqual(fixture.operations, [], 'Hosted requests must not create phantom capture sessions')

    fixture.authenticated = false
    for (const handler of Object.values(compiled.exports)) assert.equal((await handler(request())).status, 401)
    fixture.authenticated = true
    fixture.ownsAlbum = false
    for (const handler of Object.values(compiled.exports)) assert.equal((await handler(request())).status, 404)
    fixture.ownsAlbum = true
    for (const handler of Object.values(compiled.exports)) assert.equal((await handler(request({ albumId: '' }))).status, 400)

    delete process.env.VERCEL_ENV
    delete process.env.VERCEL_URL
    const connected = await compiled.exports.connect(request())
    assert.equal(connected.status, 200)
    assert.deepEqual(await connected.json(), { success: true, connected: true, cameraName: 'Canon EOS Fixture' })
    assert.equal(fixture.gphotoCalls, 1)
    assert.deepEqual(fixture.operations, [
      { table: 'camera_sessions', operation: 'update' },
      { table: 'camera_sessions', operation: 'insert' },
    ])

    fixture.operations = []
    fixture.stdout = 'Model                          Port\n----------------------------------------------------------\n'
    const missing = await compiled.exports.connect(request())
    assert.equal(missing.status, 200)
    assert.deepEqual(await missing.json(), { success: true, connected: false })
    assert.deepEqual(fixture.operations, [], 'No detected camera must not create a connected row')
    fixture.stdout = 'Canon EOS Fixture              usb:001,002\n'
    for (const operation of ['update', 'insert'] as const) {
      fixture.writeError = operation
      const failed = await compiled.exports.connect(request())
      assert.equal(failed.status, 500)
      assert.notEqual((await failed.json()).connected, true, 'Failed persistence must never report a connection')
    }
    fixture.writeError = null
    process.env.VERCEL_URL = 'ciiya.test'
    assert.equal((await compiled.exports.connect(request())).status, 409, 'A hosted URL alone still blocks server USB access')
    console.log('Camera connection checks passed: hosted USB/session guards, auth/ownership, local USB fixture and failed persistence.')
  } finally {
    if (previousEnv === undefined) delete process.env.VERCEL_ENV
    else process.env.VERCEL_ENV = previousEnv
    if (previousUrl === undefined) delete process.env.VERCEL_URL
    else process.env.VERCEL_URL = previousUrl
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
