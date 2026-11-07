/* global __dirname */
/* eslint-disable @typescript-eslint/no-require-imports -- Offline CommonJS harness uses installed tooling only. */
/* Offline only: synthetic identities, fake DB rows and public URL configuration. No servers, environment files or real fetch/writes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('../node_modules/typescript');

const root = path.resolve(__dirname, '..');
const ownerId = '11111111-1111-4111-8111-111111111111';
const otherOwnerId = '22222222-2222-4222-8222-222222222222';
const albumId = '33333333-3333-4333-8333-333333333333';
const otherAlbumId = '44444444-4444-4444-8444-444444444444';
const photoId = '55555555-5555-4555-8555-555555555555';
// Object IDs are generated before (and independently of) the DB photo ID.
const objectId = '66666666-6666-4666-8666-666666666666';
const accessToken = 'offline.user.signature';
const previewPath = `${ownerId}/${albumId}/preview/${objectId}.jpg`;
const thumbnailPath = `${ownerId}/${albumId}/thumbnail/${objectId}.jpg`;
const fixtureEnv = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://supabase-offline.invalid',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'offline-public-key',
  SUPABASE_SERVICE_ROLE_KEY: 'offline-admin-key-never-used',
  R2_PUBLIC_BASE_URL: 'https://media-offline.invalid',
};
const routePaths = {
  details: 'src/app/api/mobile/albums/[id]/details/route.ts',
  cover: 'src/app/api/mobile/albums/[id]/cover/route.ts',
};

function load(relative, mocks, env, output, cache = new Map()) {
  const filename = path.resolve(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const moduleUnderTest = { exports: {} };
  cache.set(filename, moduleUnderTest);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    fileName: filename,
  }).outputText;
  const requireLocal = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    const resolved = specifier.startsWith('@/')
      ? path.resolve(root, 'src', specifier.slice(2))
      : specifier.startsWith('.') ? path.resolve(path.dirname(filename), specifier) : null;
    if (!resolved) throw new Error(`Unmocked dependency: ${specifier}`);
    return load(path.relative(root, `${resolved}.ts`), mocks, env, output, cache);
  };
  const noNetwork = () => { throw new Error('Offline album edit tests must never use fetch'); };
  const fixtureConsole = Object.fromEntries(['log', 'warn', 'error', 'info'].map((method) => [method, (...values) => output.push({ method, values })]));
  new Function('require', 'module', 'exports', 'process', 'console', 'fetch', compiled)(
    requireLocal, moduleUnderTest, moduleUnderTest.exports, { env }, fixtureConsole, noNetwork,
  );
  return moduleUnderTest.exports;
}

function harness(options = {}) {
  const env = { ...fixtureEnv, ...options.env };
  const calls = [], clients = [], output = [];
  let authCalls = 0, bodyReads = 0, cookieReads = 0, ambientReads = 0;
  const album = Object.hasOwn(options, 'album') ? options.album : { id: albumId, owner_id: ownerId, status: 'active' };
  const photo = Object.hasOwn(options, 'photo') ? options.photo : {
    id: photoId, owner_id: ownerId, album_id: albumId, processing_status: 'done',
    storage_provider: 'r2', storage_bucket: 'offline-media',
    preview_path: previewPath, thumbnail_path: thumbnailPath,
    // These must never be read or copied into the album or response.
    original_url: 'https://private.invalid/original?signature=offline-private-secret',
    public_url: 'https://private.invalid/original?signature=offline-private-secret',
    preview_url: 'https://stale.invalid/preview?signature=offline-private-secret',
  };

  const client = {
    auth: {
      async getUser() {
        authCalls++;
        if (options.authThrows) throw new Error('offline-private-secret auth exception');
        return {
          data: { user: Object.hasOwn(options, 'user') ? options.user : { id: ownerId } },
          error: options.authError || null,
        };
      },
    },
    from(table) {
      assert.ok(table === 'albums' || table === 'photos', `No other table may be accessed: ${table}`);
      const call = { table, operation: 'select', columns: null, filters: [], payload: null };
      calls.push(call);
      const query = {
        select(columns) {
          assert.equal(typeof columns, 'string');
          assert.ok(!columns.includes('*'), 'Select only explicit safe columns');
          assert.ok(!/(password|token|original|public_url|image_url|preview_url|thumbnail_url|sd_|hd_|uhd_)/.test(columns), 'Never read passwords, share tokens or stored/download URLs');
          call.columns = columns;
          return query;
        },
        update(payload) {
          assert.equal(table, 'albums', 'Only album metadata may be updated');
          call.operation = 'update';
          call.payload = payload;
          return query;
        },
        eq(field, value) { call.filters.push([field, value]); return query; },
        async maybeSingle() {
          assert.equal(call.filters.find(([field]) => field === 'owner_id')?.[1], options.user?.id || ownerId, 'Every query must be scoped to the verified token owner');
          const expectedId = table === 'photos' ? photoId : albumId;
          assert.equal(call.filters.find(([field]) => field === 'id')?.[1], expectedId, 'Every query must be scoped to the requested album/photo');
          if (table === 'albums') assert.ok(call.filters.some(([field, value]) => field === 'status' && value === 'active'), 'Every album read and update excludes inactive/deleted rows');
          if (table === 'photos') assert.ok(call.filters.some(([field, value]) => field === 'album_id' && value === albumId), 'A cover photo must belong to the exact album');

          if (call.operation === 'update') {
            assert.equal(call.columns, 'id', 'An acknowledged update must return its matching ID only');
            assert.deepEqual(Object.keys(call.payload).sort(), options.route === 'cover' ? ['cover_photo_id', 'cover_url'] : ['description', 'title']);
            if (options.updateThrows) throw new Error('offline-private-secret update exception');
            return { data: Object.hasOwn(options, 'updated') ? options.updated : { id: albumId }, error: options.updateError || null };
          }

          if (options.readThrows === table) throw new Error('offline-private-secret read exception');
          const row = table === 'albums' ? album : photo;
          const error = table === 'albums' ? options.albumError : options.photoError;
          if (!row || error || !call.filters.every(([field, value]) => row[field] === value)) return { data: null, error: error || null };
          const selected = Object.fromEntries(call.columns.split(',').map((column) => [column, row[column]]));
          return { data: selected, error: null };
        },
        insert() { throw new Error('Album editing must not insert rows'); },
        delete() { throw new Error('Album editing must not delete rows'); },
      };
      return query;
    },
    rpc() { throw new Error('Album editing must not call mutation RPCs'); },
    get storage() { throw new Error('Album editing must not access storage adapters'); },
  };
  const cache = new Map();
  const mocks = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    'next/headers': {
      async headers() { ambientReads++; throw new Error('Native edits cannot inherit ambient auth'); },
      cookies() { cookieReads++; throw new Error('Native edits cannot read browser cookies'); },
    },
    '@supabase/supabase-js': { createClient(...args) {
      clients.push(args);
      assert.equal(args[1], fixtureEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'Never use an admin/service-role key');
      if (options.clientThrows) throw new Error('offline-private-secret client exception');
      return client;
    } },
  };

  return {
    calls, clients, output,
    get authCalls() { return authCalls; },
    get bodyReads() { return bodyReads; },
    get cookieReads() { return cookieReads; },
    get ambientReads() { return ambientReads; },
    get writes() { return calls.filter((call) => call.operation === 'update'); },
    async request(route = options.route || 'details', body = route === 'cover' ? { photoId } : { title: ' New title ', description: ' Description ' }, id = albumId) {
      options.route = route;
      const { PATCH, runtime, dynamic } = load(routePaths[route], mocks, env, output, cache);
      assert.equal(runtime, 'nodejs');
      assert.equal(dynamic, 'force-dynamic');
      const headers = new Headers({ cookie: 'offline-browser-owner=B', 'x-worker-secret': 'offline-worker-secret' });
      const authorization = Object.hasOwn(options, 'authorization') ? options.authorization : `Bearer ${accessToken}`;
      if (authorization !== null) headers.set('authorization', authorization);
      return PATCH({ headers, async json() {
        bodyReads++;
        if (options.bodyThrows) throw new Error('offline-private-secret body exception');
        return body;
      } }, { params: Promise.resolve({ id }) });
    },
  };
}

async function assertResponse(response, status, expected) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
  assert.equal(response.headers.get('set-cookie'), null);
  const body = await response.json();
  if (expected) assert.deepEqual(body, expected);
  assert.ok(!JSON.stringify(body).includes('offline-private-secret'), 'Never expose raw errors or signed URLs');
  assert.ok(!JSON.stringify(body).includes(accessToken), 'Never expose access tokens');
  return body;
}

for (const route of ['details', 'cover']) {
  test(`${route}: missing/malformed/Sync credentials cannot inherit browser or ambient identity`, async () => {
    for (const authorization of [null, '', ' ', 'Basic offline', 'Bearer a.b', 'Bearer a.b.c.d', 'Bearer a.b.c extra', `Bearer ciiya_sync_${'A'.repeat(43)}`]) {
      const h = harness({ authorization, route });
      await assertResponse(await h.request(), 401, { error: 'Unauthorized' });
      assert.equal(h.clients.length, 0);
      assert.equal(h.authCalls, 0);
      assert.equal(h.bodyReads, 0);
      assert.equal(h.calls.length, 0);
      assert.equal(h.cookieReads, 0);
      assert.equal(h.ambientReads, 0);
    }
  });

  test(`${route}: unverifiable, malformed and errored token identities fail before body/DB access`, async () => {
    for (const options of [{ user: null }, { user: {} }, { user: { id: 'not-a-uuid' } }, { user: { id: ownerId }, authError: { message: 'offline-private-secret auth failure' } }]) {
      const h = harness({ route, ...options });
      await assertResponse(await h.request(), 401, { error: 'Unauthorized' });
      assert.equal(h.authCalls, 1);
      assert.equal(h.bodyReads, 0);
      assert.equal(h.calls.length, 0);
      assert.equal(h.output.length, 0);
    }
  });

  test(`${route}: route ID is awaited and validated before body/DB access`, async () => {
    for (const id of ['', 'album', '../album', `${albumId}?private`, `${albumId} `, null, 42]) {
      const h = harness({ route });
      await assertResponse(await h.request(route, {}, id), 404, { error: 'Album not found' });
      assert.equal(h.bodyReads, 0);
      assert.equal(h.calls.length, 0);
    }
  });

  test(`${route}: foreign/missing/inactive/deleted albums never permit any update`, async () => {
    for (const album of [null, { id: albumId, owner_id: otherOwnerId, status: 'active' }, ...['inactive', 'deleted', null].map((status) => ({ id: albumId, owner_id: ownerId, status }))]) {
      const h = harness({ route, album });
      await assertResponse(await h.request(), 404, { error: 'Album not found' });
      assert.equal(h.calls.length, 1);
      assert.equal(h.writes.length, 0);
    }
  });

  test(`${route}: zero-row or mismatched update acknowledgements are not success`, async () => {
    for (const updated of [null, {}, { id: otherAlbumId }]) {
      const h = harness({ route, updated });
      await assertResponse(await h.request(), 404, { error: 'Album not found' });
      assert.equal(h.writes.length, 1);
      assert.equal(h.writes[0].columns, 'id');
    }
  });

  test(`${route}: malformed JSON and non-object bodies fail without any query`, async () => {
    const broken = harness({ route, bodyThrows: true });
    await assertResponse(await broken.request(), 400);
    assert.equal(broken.calls.length, 0);
    for (const body of [null, [], 'title', 42, true, new Date(), Object.create(null)]) {
      const h = harness({ route });
      await assertResponse(await h.request(route, body), 400);
      assert.equal(h.calls.length, 0);
    }
  });

  test(`${route}: errors/throws return generic private no-store failure with no sensitive logs`, async () => {
    for (const options of [
      { clientThrows: true }, { authThrows: true }, { readThrows: 'albums' },
      { albumError: { message: 'offline-private-secret album failure' } },
      { updateError: { message: 'offline-private-secret update failure' } }, { updateThrows: true },
    ]) {
      const h = harness({ route, ...options });
      const body = await assertResponse(await h.request(), 500);
      assert.equal(body.error, route === 'details' ? 'Unable to save album details' : 'Unable to save album cover');
      assert.equal(h.output.length, 0);
    }
  });
}

test('details: edits only trimmed title/description as the verified token owner and requires a returned ID', async () => {
  const h = harness();
  await assertResponse(await h.request(), 200, { success: true });
  assert.equal(h.clients.length, 1);
  assert.deepEqual(h.clients[0], [fixtureEnv.NEXT_PUBLIC_SUPABASE_URL, fixtureEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }]);
  assert.equal(h.authCalls, 1);
  assert.equal(h.writes.length, 1);
  assert.deepEqual(h.writes[0].payload, { title: 'New title', description: 'Description' });
  assert.equal(h.cookieReads, 0);
  assert.equal(h.ambientReads, 0);
  assert.equal(h.output.length, 0);
});

test('details: empty descriptions clear to null, with boundary lengths accepted', async () => {
  for (const [title, description, expectedDescription] of [['x', '   ', null], ['x'.repeat(120), 'd'.repeat(500), 'd'.repeat(500)]]) {
    const h = harness();
    await assertResponse(await h.request('details', { title, description }), 200, { success: true });
    assert.deepEqual(h.writes[0].payload, { title, description: expectedDescription });
  }
});

test('details: invalid/missing/string-coerced/overlong fields cannot write', async () => {
  for (const body of [
    {}, { title: 'x' }, { description: 'd' },
    { title: '', description: '' }, { title: ' \n\t ', description: '' },
    { title: 'x'.repeat(121), description: '' }, { title: 'x', description: 'd'.repeat(501) },
    { title: 1, description: '' }, { title: 'x', description: null }, { title: 'x', description: [] },
  ]) {
    const h = harness();
    await assertResponse(await h.request('details', body), 400, { error: 'Invalid album details' });
    assert.equal(h.calls.length, 0);
  }
});

test('details: password/download/publication/ownership/delete/extra fields are rejected, never stripped then applied', async () => {
  for (const [field, value] of [
    ['password', 'offline-private-secret'], ['password_hash', 'offline-private-secret'], ['isPasswordProtected', false],
    ['allowDownload', true], ['downloadSize', 'original'], ['allow_original_download', true],
    ['is_public', true], ['autoPublish', true], ['share_token', 'offline-private-secret'],
    ['owner_id', otherOwnerId], ['user_id', otherOwnerId], ['status', 'deleted'],
    ['cover_url', 'https://private.invalid/original'], ['albumId', otherAlbumId], ['extra', true], ['__proto__', {}],
  ]) {
    const body = JSON.parse(JSON.stringify({ title: 'New title', description: 'Description', [field]: value }));
    const h = harness();
    await assertResponse(await h.request('details', body), 400, { error: 'Invalid album details' });
    assert.equal(h.calls.length, 0);
  }
});

test('details: uppercase album UUID is normalized and acknowledgement is still exact', async () => {
  const h = harness();
  await assertResponse(await h.request('details', { title: 'x', description: '' }, albumId.toUpperCase()), 200, { success: true });
  assert.equal(h.writes[0].filters.find(([field]) => field === 'id')[1], albumId);
});

test('cover: a ready owned R2 derivative updates exactly the cover metadata, with no private URL response', async () => {
  const h = harness({ route: 'cover' });
  await assertResponse(await h.request(), 200, { success: true });
  assert.equal(h.clients.length, 1);
  assert.equal(h.calls.length, 3);
  assert.deepEqual(h.writes[0].payload, { cover_photo_id: photoId, cover_url: `${fixtureEnv.R2_PUBLIC_BASE_URL}/${previewPath}` });
  assert.equal(h.calls[1].table, 'photos');
  assert.equal(h.calls[1].columns, 'id,owner_id,album_id,processing_status,storage_provider,storage_bucket,preview_path,thumbnail_path');
  assert.equal(h.output.length, 0);
});

test('cover: missing/foreign-owner/cross-album photos never update the album', async () => {
  for (const photo of [null, { id: photoId, owner_id: otherOwnerId, album_id: albumId }, { id: photoId, owner_id: ownerId, album_id: otherAlbumId }]) {
    const h = harness({ route: 'cover', photo });
    await assertResponse(await h.request(), 404, { error: 'Photo not found' });
    assert.equal(h.writes.length, 0);
  }
});

test('cover: pending/processing/failed/unrecognized photo processing status cannot become a cover', async () => {
  for (const processing_status of ['pending', 'processing', 'failed', null, 'DONE']) {
    const h = harness({ route: 'cover', photo: { id: photoId, owner_id: ownerId, album_id: albumId, processing_status, storage_provider: 'r2', preview_path: previewPath } });
    await assertResponse(await h.request(), 409, { error: 'Cover photo is not ready' });
    assert.equal(h.writes.length, 0);
  }
});

test('cover: invalid photo IDs and any URL/owner/album/extra body field are rejected before DB access', async () => {
  for (const body of [
    {}, { photoId: null }, { photoId: 4 }, { photoId: '../photo' }, { photoId: `${photoId} ` },
    { photoId, albumId }, { photoId, owner_id: ownerId }, { photoId, coverUrl: 'https://private.invalid/original' },
    { photoId, preview_path: previewPath }, { photoId, public_url: 'data:image/png;base64,offline' },
  ]) {
    const h = harness({ route: 'cover' });
    await assertResponse(await h.request('cover', body), 400, { error: 'Invalid cover photo' });
    assert.equal(h.calls.length, 0);
  }
});

test('cover: unsafe/cross-owner/cross-album/private/download/nested derivative paths fail closed', async () => {
  const paths = [
    null, '', `${otherOwnerId}/${albumId}/preview/${objectId}.jpg`, `${ownerId}/${otherAlbumId}/preview/${objectId}.jpg`,
    `${ownerId}/${albumId}/original/${objectId}.jpg`, `${ownerId}/${albumId}/hd/${objectId}.jpg`,
    `${ownerId}/${albumId}/cover/${objectId}.jpg`, `${ownerId}/${albumId}/preview/nested/${objectId}.jpg`,
    `${ownerId}/${albumId}/preview/../original/${objectId}.jpg`, `${previewPath}?signature=offline-private-secret`,
    `${previewPath}#offline`, `${ownerId}/${albumId}/preview/%2e%2e.jpg`,
    `https://private.invalid/${previewPath}`, `data:image/png;base64,offline`,
  ];
  for (const derivativePath of paths) {
    const h = harness({ route: 'cover', photo: {
      id: photoId, owner_id: ownerId, album_id: albumId, processing_status: 'done', storage_provider: 'r2',
      preview_path: derivativePath, thumbnail_path: null,
    } });
    await assertResponse(await h.request(), 409, { error: 'Cover photo is not ready' });
    assert.equal(h.writes.length, 0);
  }
});

test('cover: no fallback to stored public/image/original/signed/data/external URLs without safe derivative paths', async () => {
  for (const url of ['https://private.invalid/original?signature=offline-private-secret', 'https://media-offline.invalid/original/a.jpg', 'https://external.invalid/preview.jpg', 'data:image/png;base64,offline', 'http://media-offline.invalid/preview.jpg']) {
    const h = harness({ route: 'cover', photo: {
      id: photoId, owner_id: ownerId, album_id: albumId, processing_status: 'done', storage_provider: 'r2',
      preview_path: null, thumbnail_path: null,
      preview_url: url, thumbnail_url: url, public_url: url, image_url: url, original_url: url,
    } });
    await assertResponse(await h.request(), 409, { error: 'Cover photo is not ready' });
    assert.equal(h.writes.length, 0);
  }
});

test('cover: thumbnail fallback is separately verified in its own public folder', async () => {
  for (const preview_path of [null, `${ownerId}/${albumId}/original/${objectId}.jpg`]) {
    const h = harness({ route: 'cover', photo: {
      id: photoId, owner_id: ownerId, album_id: albumId, processing_status: 'done', storage_provider: 'r2',
      preview_path, thumbnail_path: thumbnailPath,
    } });
    await assertResponse(await h.request(), 200, { success: true });
    assert.deepEqual(h.writes[0].payload, { cover_photo_id: photoId, cover_url: `${fixtureEnv.R2_PUBLIC_BASE_URL}/${thumbnailPath}` });
  }
});

test('cover: a preview path mislabeled as thumbnail does not bypass the folder check', async () => {
  const h = harness({ route: 'cover', photo: {
    id: photoId, owner_id: ownerId, album_id: albumId, processing_status: 'done', storage_provider: 'r2',
    preview_path: null, thumbnail_path: previewPath,
  } });
  await assertResponse(await h.request(), 409, { error: 'Cover photo is not ready' });
  assert.equal(h.writes.length, 0);
});

test('cover: unsafe or missing public base never returns a signed/private/credentialed cover URL', async () => {
  for (const R2_PUBLIC_BASE_URL of ['', 'http://media-offline.invalid', 'https://user:offline-private-secret@media-offline.invalid', 'https://media-offline.invalid?signature=offline-private-secret', 'https://media-offline.invalid#offline', 'data:image/png;base64,offline']) {
    const h = harness({ route: 'cover', env: { R2_PUBLIC_BASE_URL } });
    await assertResponse(await h.request(), 409, { error: 'Cover photo is not ready' });
    assert.equal(h.writes.length, 0);
  }
});

test('cover: an unsupported provider cannot silently fall back to Supabase', async () => {
  const h = harness({ route: 'cover', photo: {
    id: photoId, owner_id: ownerId, album_id: albumId, processing_status: 'done', storage_provider: 'unknown',
    preview_path: previewPath, thumbnail_path: thumbnailPath,
  } });
  await assertResponse(await h.request(), 409, { error: 'Cover photo is not ready' });
  assert.equal(h.writes.length, 0);
});

test('cover: legacy Supabase preview/download path is not used, but its owned public thumbnail is safe', async () => {
  const h = harness({ route: 'cover', photo: {
    id: photoId, owner_id: ownerId, album_id: albumId, processing_status: 'done', storage_provider: null,
    storage_bucket: null, preview_path: `${ownerId}/${albumId}/hd/${objectId}.jpg`, thumbnail_path: thumbnailPath,
  } });
  await assertResponse(await h.request(), 200, { success: true });
  assert.deepEqual(h.writes[0].payload, {
    cover_photo_id: photoId,
    cover_url: `${fixtureEnv.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/albums/${thumbnailPath}`,
  });
});

test('cover: private/injected Supabase bucket cannot supply a URL-only fallback', async () => {
  for (const storage_bucket of ['originals', '../albums', 'album?signature=offline-private-secret']) {
    const h = harness({ route: 'cover', photo: {
      id: photoId, owner_id: ownerId, album_id: albumId, processing_status: 'done', storage_provider: 'supabase',
      storage_bucket, preview_path: null, thumbnail_path: null,
      thumbnail_url: 'https://private.invalid/original?signature=offline-private-secret',
    } });
    await assertResponse(await h.request(), 409, { error: 'Cover photo is not ready' });
    assert.equal(h.writes.length, 0);
  }
});

test('cover: legacy private originals bucket metadata never makes a private cover URL', async () => {
  const h = harness({ route: 'cover', photo: {
    id: photoId, owner_id: ownerId, album_id: albumId, processing_status: 'done', storage_provider: 'supabase',
    storage_bucket: 'originals', preview_path: previewPath, thumbnail_path: null,
  } });
  await assertResponse(await h.request(), 200, { success: true });
  assert.equal(h.writes[0].payload.cover_url, `${fixtureEnv.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/albums/${previewPath}`);
});

test('cover: photo read errors and exceptions do not write or leak private diagnostic metadata', async () => {
  for (const options of [{ photoError: { message: 'offline-private-secret photo query' } }, { readThrows: 'photos' }]) {
    const h = harness({ route: 'cover', ...options });
    await assertResponse(await h.request(), 500, { error: 'Unable to save album cover' });
    assert.equal(h.writes.length, 0);
    assert.equal(h.output.length, 0);
  }
});
