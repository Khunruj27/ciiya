/* global __dirname, Response */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

// Execute the real modules with native, filesystem and network boundaries mocked.
// No test has access to live Supabase credentials, objects or API endpoints.
function load(name, mocks = {}, globals = {}) {
  const filename = path.join(__dirname, '../src/lib/uploads', name + '.ts');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    require(name) {
      if (!(name in mocks)) throw Error('Unmocked dependency: ' + name);
      return mocks[name];
    },
    Date, Map, Set, Promise, AbortController, console,
    setTimeout: () => 1,
    clearTimeout() {},
    ...globals,
  }, { filename });
  return exports;
}

const types = load('types');
const boundedFetch = load('../bounded-fetch');
const options = { size: 'original', autoFaceScan: false, autoPublish: false };
const prepared = {
  fileName: 'photo.jpg', mimeType: 'image/jpeg', sizeBytes: 10,
  fileHash: 'hash', localName: 'copy.jpg',
};
function item(overrides = {}) {
  return {
    ...prepared, ...options, id: 'upload-id', ownerId: 'A', albumId: 'album',
    status: 'queued', progress: 0, attempts: 0, failure: null,
    registering: false, staged: null, createdAt: 1, ...overrides,
  };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const plain = value => JSON.parse(JSON.stringify(value));
const stagedPath = 'A/album/original/stored.jpg';

function transportHarness({ owner = 'A', response, uploadStatus = 200, refreshOwner = 'A', missing = false } = {}) {
  const requests = [], removed = [], uploads = [], states = [];
  const state = { owner, durable: null, authReads: 0, fileReads: 0 };
  const supabase = {
    auth: {
      getSession: async () => {
        state.authReads++;
        return { data: { session: state.owner ? {
          access_token: 'mock-token', user: { id: state.owner },
        } : null } };
      },
      refreshSession: async () => ({ data: { session: {
        access_token: 'refreshed-token', user: { id: refreshOwner },
      } } }),
    },
    storage: { from: () => ({ remove: async paths => { removed.push(...paths); } }) },
  };
  const { liveTransport } = load('live-transport', {
    '@/lib/config': { SITE_URL: 'https://mock.invalid' },
    '@/lib/supabase': { supabase },
    '@/lib/bounded-fetch': boundedFetch,
    './files': { localFile: () => {
      state.fileReads++;
      return { exists: !missing, async upload(url, init) {
        uploads.push({ url, ...init });
        return { status: uploadStatus };
      } };
    } },
    './types': types,
  }, {
    async fetch(url, init) {
      const request = { url, ...init, body: JSON.parse(init.body) };
      requests.push(request);
      const result = response ? await response(request, state) : {
        status: 200, json: async () => ({ success: true, duplicate: true }),
      };
      if (result instanceof Response) return result;
      return new Response(JSON.stringify(await result.json()), {
        status: result.status, headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  function hooks(uploadItem, extra = {}) {
    state.durable = plain(uploadItem);
    return {
      signal: new AbortController().signal,
      onProgress() {},
      onStaged(staged) {
        state.durable.staged = plain(staged);
        states.push(plain(state.durable));
      },
      onFinishing() {
        state.durable.registering = true;
        state.durable.status = 'finishing';
        states.push(plain(state.durable));
      },
      ...extra,
    };
  }
  return { liveTransport, hooks, state, requests, removed, uploads, states };
}

test('legacy registering journal is held before auth or file lookup without touching its accepted Supabase original', async () => {
  const h = transportHarness();
  const pending = item({ registering: true, staged: { storagePath: stagedPath, uncertain: false } });
  await assert.rejects(h.liveTransport.upload(pending, h.hooks(pending)), { failure: 'server', retryable: false });
  assert.equal(h.state.authReads, 0);
  assert.equal(h.state.fileReads, 0);
  assert.deepEqual(h.requests, []);
  assert.deepEqual(h.uploads, []);
  assert.deepEqual(h.states, []);
  assert.deepEqual(h.state.durable, pending);
  assert.deepEqual(h.removed, []);
});

test('every legacy staging shape stays held on repeat retries, even with a missing file or foreign active account', async () => {
  for (const uncertain of [false, true]) {
    for (const registering of [false, true]) {
      const h = transportHarness({ owner: 'B', missing: true });
      const pending = item({ registering, staged: { storagePath: stagedPath, uncertain } });
      for (let attempt = 0; attempt < 2; attempt++) {
        await assert.rejects(h.liveTransport.upload(pending, h.hooks(pending)), {
          failure: 'server', retryable: false, signedOut: false,
        });
      }
      assert.equal(h.state.authReads, 0);
      assert.equal(h.state.fileReads, 0);
      assert.deepEqual(h.requests, []);
      assert.deepEqual(h.uploads, []);
      assert.deepEqual(h.states, []);
      assert.deepEqual(h.state.durable, pending);
      assert.deepEqual(h.removed, []);
    }
  }
});

test('R2_UPLOADS_DISABLED fails closed without fallback, staged journal changes or automatic retries', async () => {
  for (const status of [200, 403, 503]) {
    const h = transportHarness({ response: async () => ({
      status, json: async () => ({ success: false, code: 'R2_UPLOADS_DISABLED' }),
    }) });
    const pending = item();
    await assert.rejects(h.liveTransport.upload(pending, h.hooks(pending)), { failure: 'server', retryable: false });
    assert.equal(h.requests.length, 1);
    assert.ok(h.requests[0].url.endsWith('/api/photos/upload-url'));
    assert.deepEqual(h.uploads, []);
    assert.deepEqual(h.states, []);
    assert.deepEqual(h.removed, []);
  }
});

test('R2_UPLOADS_DISABLED overrides contradictory finalize success markers without cancellation or automatic retry', async () => {
  for (const status of [200, 403, 503]) {
    const h = transportHarness({ response: async request => ({
      status: request.url.endsWith('/upload-url') ? 200 : status,
      json: async () => request.url.endsWith('/upload-url') ? {
        success: true, uploadSessionId: 'reservation', uploadUrl: 'https://r2.mock.invalid',
        headers: {}, storagePath: stagedPath, bucket: 'albums', fileHash: 'hash',
      } : { success: true, duplicate: true, cleanupSafe: true, code: 'R2_UPLOADS_DISABLED' },
    }) });
    const pending = item();
    await assert.rejects(h.liveTransport.upload(pending, h.hooks(pending)), {
      failure: 'server', retryable: false, signedOut: false,
    });
    assert.equal(h.requests.length, 2);
    assert.ok(h.requests.every(request => request.method === 'POST'));
    assert.equal(h.uploads.length, 1);
    assert.deepEqual(h.removed, []);
  }
});

test('only a successful R2 reserve duplicate settles the item without uploading bytes', async () => {
  for (const status of [200, 500]) {
    for (const success of [false, true]) {
      const h = transportHarness({ response: async () => ({
        status, json: async () => ({ success, duplicate: true }),
      }) });
      const pending = item();
      if (status === 200 && success) {
        assert.equal(await h.liveTransport.upload(pending, h.hooks(pending)), 'duplicate');
      } else {
        await assert.rejects(h.liveTransport.upload(pending, h.hooks(pending)), { failure: 'server' });
      }
      assert.equal(h.requests.length, 1);
      assert.deepEqual(h.uploads, []);
      assert.deepEqual(h.removed, []);
    }
  }
});

test('an unsuccessful R2 finalize duplicate-shaped response does not authorize cleanup', async () => {
  const h = transportHarness({ response: async request => ({
    status: request.url.endsWith('/upload-url') ? 200 : 500,
    json: async () => request.url.endsWith('/upload-url') ? {
      success: true, uploadSessionId: 'reservation', uploadUrl: 'https://r2.mock.invalid',
      headers: {}, storagePath: stagedPath, bucket: 'albums', fileHash: 'hash',
    } : { success: false, duplicate: true },
  }) });
  const pending = item();
  await assert.rejects(h.liveTransport.upload(pending, h.hooks(pending)), { failure: 'server' });
  assert.equal(h.requests.length, 2);
  assert.ok(h.requests.every(request => request.method === 'POST'));
  assert.equal(h.uploads.length, 1);
  assert.deepEqual(h.removed, []);
  assert.equal(h.state.durable.registering, true);
});

test('an R2 finalization refusal retains stored bytes without clearing the finishing intent', async () => {
  const h = transportHarness({ response: async request => ({
    status: request.url.endsWith('/upload-url') ? 200 : 404,
    json: async () => request.url.endsWith('/upload-url') ? {
      success: true, uploadSessionId: 'reservation', uploadUrl: 'https://r2.mock.invalid',
      headers: {}, storagePath: stagedPath, bucket: 'albums', fileHash: 'hash',
    } : { error: 'not found' },
  }) });
  const pending = item({ registering: true });
  await assert.rejects(h.liveTransport.upload(pending, h.hooks(pending)), { failure: 'album-missing' });
  assert.equal(h.requests.length, 2);
  assert.ok(h.requests.every(request => request.method === 'POST'));
  assert.deepEqual(h.removed, []);
  assert.equal(h.state.durable.registering, true);
});

test('discard is a remote no-op for certain, finishing, uncertain, foreign-path and unstaged items', async () => {
  const h = transportHarness();
  h.liveTransport.discard(item());
  h.liveTransport.discard(item({ staged: { storagePath: stagedPath, uncertain: false } }));
  h.liveTransport.discard(item({ registering: true, staged: { storagePath: stagedPath, uncertain: false } }));
  h.liveTransport.discard(item({ staged: { storagePath: stagedPath, uncertain: true } }));
  h.liveTransport.discard(item({ staged: { storagePath: 'B/album/original/foreign.jpg', uncertain: false } }));
  await flush();
  assert.equal(h.state.authReads, 0);
  assert.equal(h.state.fileReads, 0);
  assert.deepEqual(h.requests, []);
  assert.deepEqual(h.uploads, []);
  assert.deepEqual(h.removed, []);
});

test('a missing or different active account sends neither uploads nor cleanup', async () => {
  for (const owner of [null, 'B']) {
    const h = transportHarness({ owner });
    const pending = item();
    await assert.rejects(h.liveTransport.upload(pending, h.hooks(pending)), { signedOut: true });
    h.liveTransport.discard(item({ staged: { storagePath: stagedPath, uncertain: false } }));
    await flush();
    assert.deepEqual(h.requests, []);
    assert.deepEqual(h.uploads, []);
    assert.deepEqual(h.removed, []);
  }
});

test('token refresh cannot resend an old account upload as the newly signed-in account', async () => {
  const h = transportHarness({ refreshOwner: 'B', response: async () => ({ status: 401, json: async () => ({}) }) });
  const pending = item();
  await assert.rejects(h.liveTransport.upload(pending, h.hooks(pending)), { signedOut: true });
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].headers.Authorization, 'Bearer mock-token');
  assert.deepEqual(h.uploads, []);
});

test('an aborted upload never starts fetch', async () => {
  const h = transportHarness();
  const controller = new AbortController();
  controller.abort();
  const pending = item();
  await assert.rejects(h.liveTransport.upload(pending, h.hooks(pending, { signal: controller.signal })));
  assert.deepEqual(h.requests, []);
});

test('R2 retry preserves clientUploadId, accepts existing bytes and finalizes its reservation', async () => {
  const h = transportHarness({ uploadStatus: 412, response: async request => ({ status: 200, json: async () =>
    request.url.endsWith('/upload-url') ? {
      success: true, uploadSessionId: 'reservation', uploadUrl: 'https://r2.mock.invalid',
      headers: {}, storagePath: stagedPath, bucket: 'albums', fileHash: 'hash',
    } : { success: true, duplicate: false },
  }) });
  const pending = item();
  assert.equal(await h.liveTransport.upload(pending, h.hooks(pending)), 'done');
  assert.equal(h.requests[0].body.clientUploadId, pending.id);
  assert.equal(h.uploads.length, 1);
  assert.equal(h.uploads[0].httpMethod, 'PUT');
  assert.equal(h.requests[1].body.uploadSessionId, 'reservation');
  assert.equal(h.requests[1].body.storageProvider, 'r2');
  assert.deepEqual(h.removed, []);
});

test('R2 repaired duplicates retain their adopted original, even if an inconsistent response also claims cleanupSafe', async () => {
  for (const cleanupSafe of [undefined, false, true]) {
    const h = transportHarness({ response: async request => ({ status: 200, json: async () =>
      request.url.endsWith('/upload-url') ? {
        success: true, uploadSessionId: 'reservation', uploadUrl: 'https://r2.mock.invalid',
        headers: {}, storagePath: stagedPath, bucket: 'albums', fileHash: 'hash',
      } : { success: true, duplicate: true, repaired: true, cleanupSafe },
    }) });
    const pending = item();
    assert.equal(await h.liveTransport.upload(pending, h.hooks(pending)), 'duplicate');
    assert.equal(h.requests.length, 2);
    assert.ok(h.requests.every(request => request.method === 'POST'));
    assert.equal(h.uploads.length, 1);
    assert.deepEqual(h.removed, []);
  }
});

test('R2 duplicates without an explicit cleanupSafe acknowledgement retain their possibly accepted original', async () => {
  for (const cleanupSafe of [undefined, false]) {
    const h = transportHarness({ response: async request => ({ status: 200, json: async () =>
      request.url.endsWith('/upload-url') ? {
        success: true, uploadSessionId: 'reservation', uploadUrl: 'https://r2.mock.invalid',
        headers: {}, storagePath: stagedPath, bucket: 'albums', fileHash: 'hash',
      } : { success: true, duplicate: true, cleanupSafe },
    }) });
    const pending = item();
    assert.equal(await h.liveTransport.upload(pending, h.hooks(pending)), 'duplicate');
    assert.equal(h.requests.length, 2);
    assert.ok(h.requests.every(request => request.method === 'POST'));
    assert.deepEqual(h.removed, []);
  }
});

test('even an explicitly cleanupSafe R2 duplicate cannot authorize a native reservation cancellation', async () => {
  const h = transportHarness({ response: async request => ({ status: 200, json: async () =>
    request.url.endsWith('/upload-url') && request.method === 'POST' ? {
      success: true, uploadSessionId: 'reservation', uploadUrl: 'https://r2.mock.invalid',
      headers: {}, storagePath: stagedPath, bucket: 'albums', fileHash: 'hash',
    } : { success: true, duplicate: true, cleanupSafe: true },
  }) });
  const pending = item();
  assert.equal(await h.liveTransport.upload(pending, h.hooks(pending)), 'duplicate');
  assert.equal(h.requests.length, 2);
  assert.ok(h.requests.every(request => request.method === 'POST'));
  assert.deepEqual(h.removed, []);
});

test('refused R2 finalization never cancels potentially adopted bytes, regardless of cleanupSafe', async () => {
  for (const status of [400, 403, 404, 413, 500]) {
    const h = transportHarness({ response: async request => ({
      status: request.url.endsWith('/upload-url') ? 200 : status,
      json: async () => request.url.endsWith('/upload-url') ? {
        success: true, uploadSessionId: 'reservation', uploadUrl: 'https://r2.mock.invalid',
        headers: {}, storagePath: stagedPath, bucket: 'albums', fileHash: 'hash',
      } : { success: false, cleanupSafe: true },
    }) });
    const pending = item();
    await assert.rejects(h.liveTransport.upload(pending, h.hooks(pending)));
    assert.equal(h.requests.length, 2);
    assert.ok(h.requests.every(request => request.method === 'POST'));
    assert.equal(h.uploads.length, 1);
    assert.equal(h.state.durable.registering, true);
    assert.deepEqual(h.removed, []);
  }
});

function queueHarness({ saved, nextSaved, prepare, upload, saveError = false, missing = false } = {}) {
  const writes = [], deleted = [], sweeps = [], started = [], discards = [];
  let sequence = 0;
  let appState;
  const state = { saveError, durable: saved };
  const transport = {
    upload(uploadItem, hooks) {
      started.push({ item: uploadItem, hooks });
      return upload ? upload(uploadItem, hooks, state) : new Promise(() => {});
    },
    discard(uploadItem) { discards.push(plain(uploadItem)); },
  };
  const queue = load('queue', {
    'expo-crypto': { randomUUID: () => 'upload-' + ++sequence },
    'react-native': { AppState: { addEventListener(_event, handler) { appState = handler; } } },
    '@/lib/config': { isDemoMode: true },
    './demo-transport': { demoTransport: transport },
    './live-transport': { liveTransport: transport },
    './types': types,
    './files': {
      prepareAsset: prepare || (async () => prepared),
      deleteLocalFile: name => deleted.push(name),
      localFile: () => ({ exists: !missing }),
      queueFile(name = 'queue.json') {
        const value = name === 'queue.json' ? state.durable : nextSaved;
        return { exists: value !== undefined, textSync: () => typeof value === 'string' ? value : JSON.stringify(value) };
      },
      saveQueue(value) {
        if (state.saveError) throw Error('Disk full');
        state.durable = JSON.parse(value);
        writes.push(plain(state.durable));
      },
      sweepLocalFiles: keep => sweeps.push([...keep]),
    },
  });
  return { queue, writes, deleted, sweeps, started, discards, state, appState: value => appState(value) };
}

test('legacy held journals remain failed without automatic retries and manual retry cannot clear or re-register them', async () => {
  const transport = transportHarness();
  const pending = item({ staged: { storagePath: stagedPath, uncertain: true }, registering: true });
  const h = queueHarness({
    saved: { version: 1, items: [pending] },
    upload: (uploadItem, hooks) => transport.liveTransport.upload(uploadItem, hooks),
  });
  h.queue.setUploadOwner('A');
  await flush();
  assert.equal(h.started.length, 1);
  assert.equal(h.queue.getUploads()[0].status, 'failed');
  assert.equal(h.queue.getUploads()[0].failure, 'server');
  assert.deepEqual(plain(h.queue.getUploads()[0].staged), pending.staged);
  assert.equal(h.queue.getUploads()[0].registering, true);
  h.queue.resumeUploads();
  h.appState('active');
  await flush();
  assert.equal(h.started.length, 1, 'Foregrounding does not restart a held legacy item');
  h.queue.retryUpload(pending.id);
  await flush();
  assert.equal(h.started.length, 2);
  assert.equal(h.queue.getUploads()[0].status, 'failed');
  assert.deepEqual(plain(h.queue.getUploads()[0].staged), pending.staged);
  assert.equal(h.queue.getUploads()[0].registering, true);
  assert.deepEqual(transport.requests, []);
  assert.deepEqual(transport.uploads, []);
  assert.deepEqual(transport.removed, []);
  assert.deepEqual(h.deleted, []);
});

test('a disabled R2 rollout stops the real queue without fallback or automatic foreground retry', async () => {
  const transport = transportHarness({ response: async () => ({
    status: 403, json: async () => ({ code: 'R2_UPLOADS_DISABLED' }),
  }) });
  const h = queueHarness({ upload: (uploadItem, hooks) => transport.liveTransport.upload(uploadItem, hooks) });
  h.queue.setUploadOwner('A');
  await h.queue.enqueueUploads('album', [{}], options);
  await flush();
  assert.equal(h.queue.getUploads()[0].status, 'failed');
  assert.equal(h.queue.getUploads()[0].failure, 'server');
  assert.equal(h.started.length, 1);
  h.queue.resumeUploads();
  h.appState('active');
  await flush();
  assert.equal(h.started.length, 1);
  assert.equal(transport.requests.length, 1);
  assert.deepEqual(transport.uploads, []);
  assert.deepEqual(transport.removed, []);
  assert.deepEqual(h.deleted, []);
});

test('bulk retry does not re-run a held legacy journal while ordinary failed uploads can proceed', () => {
  const held = item({ id: 'held', status: 'failed', staged: { storagePath: stagedPath, uncertain: true } });
  const ordinary = item({ id: 'ordinary', status: 'failed', localName: 'other.jpg' });
  const h = queueHarness({ saved: { version: 1, items: [held, ordinary] } });
  h.queue.setUploadOwner('A');
  assert.equal(h.started.length, 0);
  h.queue.retryFailedUploads('album');
  assert.equal(h.started.length, 1);
  assert.equal(h.started[0].item.id, 'ordinary');
  assert.equal(h.queue.getUploads().find(value => value.id === 'held').status, 'failed');
  assert.deepEqual(h.deleted, []);
  assert.deepEqual(h.discards, []);
});

test('account switch during prepare cleans only the new local copy and never inserts the old account item', async () => {
  const copy = deferred();
  const h = queueHarness({ prepare: () => copy.promise });
  h.queue.setUploadOwner('A');
  const preparing = h.queue.enqueueUploads('album', [{}], options);
  h.queue.setUploadOwner('B');
  copy.resolve(prepared);
  assert.equal((await preparing).queued, 0);
  assert.deepEqual(plain(h.queue.getUploads()), []);
  assert.deepEqual(h.deleted, ['copy.jpg']);
  assert.equal(h.started.length, 0);
});

test('A → sign out → A invalidates preparation even though the final user ID matches', async () => {
  const copy = deferred();
  const h = queueHarness({ prepare: () => copy.promise });
  h.queue.setUploadOwner('A');
  const preparing = h.queue.enqueueUploads('album', [{}], options);
  h.queue.setUploadOwner(null);
  h.queue.setUploadOwner('A');
  copy.resolve(prepared);
  await preparing;
  assert.deepEqual(plain(h.queue.getUploads()), []);
  assert.deepEqual(h.deleted, ['copy.jpg']);
  assert.equal(h.started.length, 0);
});

test('sign-out immediately hides queue snapshots and switching account cannot expose old files', async () => {
  const h = queueHarness();
  h.queue.setUploadOwner('A');
  await h.queue.enqueueUploads('album', [{}], options);
  assert.equal(h.queue.getUploads().length, 1);
  const oldId = h.queue.getUploads()[0].id;
  h.queue.setUploadOwner(null);
  assert.deepEqual(plain(h.queue.getUploads()), []);
  h.queue.setUploadOwner('B');
  h.queue.retryUpload(oldId);
  h.queue.removeUpload(oldId);
  assert.deepEqual(plain(h.queue.getUploads()), []);
  assert.equal(h.started.length, 1);
  assert.deepEqual(h.discards, []); // No cleanup as the wrong account.
});

test('hydration normalizes old finishing journals to ambiguous and persists them before resuming', () => {
  const h = queueHarness({ saved: { version: 1, items: [item({
    status: 'finishing', registering: true, staged: { storagePath: stagedPath, uncertain: false },
  })] } });
  h.queue.setUploadOwner('A');
  assert.equal(h.started.length, 1);
  assert.equal(h.started[0].item.staged.uncertain, true);
  assert.equal(h.state.durable.items[0].staged.uncertain, true);
  assert.equal(h.queue.getUploads()[0].status, 'uploading');
});

test('unreadable or partially invalid journals never sweep potentially recoverable photos', () => {
  for (const saved of ['{partial', { version: 1, items: [{ localName: 'copy.jpg' }] }, { version: 999, items: [] }]) {
    const h = queueHarness({ saved });
    h.queue.setUploadOwner(null);
    assert.deepEqual(h.sweeps, []);
    assert.deepEqual(h.deleted, []);
  }
});

test('a complete replacement journal can recover when the main journal is corrupt', () => {
  const h = queueHarness({ saved: '{broken', nextSaved: { version: 1, items: [item()] } });
  h.queue.setUploadOwner('A');
  assert.equal(h.queue.getUploads().length, 1);
  assert.equal(h.started.length, 1);
});

test('a failed durable write prevents network upload and keeps the copied file for retry', async () => {
  const h = queueHarness({ saveError: true });
  h.queue.setUploadOwner('A');
  await h.queue.enqueueUploads('album', [{}], options);
  assert.equal(h.started.length, 0);
  assert.equal(h.queue.getUploads()[0].status, 'failed');
  assert.deepEqual(h.deleted, []);
  h.state.saveError = false;
  h.queue.retryUpload(h.queue.getUploads()[0].id);
  assert.equal(h.started.length, 1);
  assert.equal(h.state.durable.items.length, 1);
});

test('R2 finishing intent is written synchronously and a write failure blocks finalization', async () => {
  let finalized = false;
  const h = queueHarness({ upload: async (_item, hooks, state) => {
    state.saveError = true;
    hooks.onFinishing();
    finalized = true;
    return 'done';
  } });
  h.queue.setUploadOwner('A');
  await h.queue.enqueueUploads('album', [{}], options);
  await flush();
  assert.equal(finalized, false);
  assert.equal(h.queue.getUploads()[0].status, 'failed');
  assert.deepEqual(h.deleted, []);
});

test('removing a finishing upload waits for cancellation before deleting its local copy', async () => {
  const ending = deferred();
  const h = queueHarness({ upload: async (_item, hooks) => {
    hooks.onStaged({ storagePath: stagedPath, uncertain: true });
    hooks.onFinishing();
    return ending.promise;
  } });
  h.queue.setUploadOwner('A');
  await h.queue.enqueueUploads('album', [{}], options);
  const pending = h.queue.getUploads()[0];
  assert.equal(pending.status, 'finishing');
  h.queue.removeUpload(pending.id);
  assert.deepEqual(plain(h.queue.getUploads()), []);
  assert.deepEqual(h.deleted, []);
  assert.deepEqual(h.discards, []);
  assert.equal(h.started[0].hooks.signal.aborted, true);
  ending.reject(Error('cancelled'));
  await flush();
  assert.deepEqual(h.deleted, ['copy.jpg']);
  assert.equal(h.discards.length, 1);
  assert.equal(h.discards[0].registering, true);
  assert.equal(h.discards[0].staged.uncertain, true);
});

test('switching accounts waits for the old native upload to settle before deleting its copy', async () => {
  const ending = deferred();
  const h = queueHarness({ upload: async () => ending.promise });
  h.queue.setUploadOwner('A');
  await h.queue.enqueueUploads('album', [{}], options);
  h.queue.setUploadOwner('B');
  assert.deepEqual(plain(h.queue.getUploads()), []);
  assert.deepEqual(h.deleted, []);
  assert.equal(h.started[0].hooks.signal.aborted, true);
  ending.reject(Error('cancelled'));
  await flush();
  assert.deepEqual(h.deleted, ['copy.jpg']);
  assert.deepEqual(h.discards, []);
});

test('completion is journaled before the local upload copy is removed', async () => {
  const h = queueHarness({ upload: async () => 'done' });
  h.queue.setUploadOwner('A');
  await h.queue.enqueueUploads('album', [{}], options);
  await flush();
  assert.equal(h.queue.getUploads()[0].status, 'done');
  assert.deepEqual(h.state.durable.items, []);
  assert.deepEqual(h.deleted, ['copy.jpg']);
});

test('a failed completion journal save retains the local copy for an idempotent restart', async () => {
  const h = queueHarness({ upload: async (_item, _hooks, state) => {
    state.saveError = true;
    return 'done';
  } });
  h.queue.setUploadOwner('A');
  await h.queue.enqueueUploads('album', [{}], options);
  await flush();
  assert.equal(h.queue.getUploads()[0].status, 'done');
  assert.equal(h.state.durable.items.length, 1);
  assert.deepEqual(h.deleted, []);
});

test('backgrounding flushes a pending journal without discarding copied files', async () => {
  const h = queueHarness();
  h.queue.setUploadOwner('A');
  await h.queue.enqueueUploads('album', [{}], options);
  h.started[0].hooks.onProgress(0.5);
  h.appState('background');
  assert.equal(h.state.durable.items.length, 1);
  assert.deepEqual(h.deleted, []);
});

function fileHarness({ mime = 'image/jpeg', copyFails = false, saveFails = false } = {}) {
  const entries = new Map([['file:///picked/original', { size: 10, md5: 'original-hash' }]]);
  const deleted = [], events = [], released = [];
  class Directory {
    constructor(...parts) { this.uri = parts.map(x => x.uri || x).join('/'); }
    get exists() { return true; }
    create() {}
    list() { return []; }
  }
  class File {
    constructor(...parts) { this.uri = parts.map(x => x.uri || x).join('/'); }
    get exists() { return entries.has(this.uri); }
    get name() { return this.uri.split('/').at(-1); }
    get size() { return entries.get(this.uri)?.size || 0; }
    create() { entries.set(this.uri, { size: 0 }); }
    write(value) { entries.get(this.uri).text = value; events.push('write:' + this.name); }
    textSync() { return entries.get(this.uri)?.text; }
    info() { return entries.get(this.uri); }
    async copy(destination) {
      entries.set(destination.uri, { ...entries.get(this.uri) });
      events.push('copy');
      if (copyFails) throw Error('copy interrupted');
    }
    moveSync(destination) {
      events.push('replace:' + destination.name);
      entries.set(destination.uri, entries.get(this.uri));
      entries.delete(this.uri);
      this.uri = destination.uri;
    }
    delete() { deleted.push(this.uri); entries.delete(this.uri); }
  }
  const files = load('files', {
    'expo-crypto': { randomUUID: () => 'owned-copy' },
    'expo-file-system': { File, Directory, Paths: { document: 'file:///documents' } },
    'expo-image-manipulator': {
      SaveFormat: { JPEG: 'jpeg' },
      ImageManipulator: { manipulate() { return {
        release() { released.push('context'); },
        async renderAsync() { return {
          release() { released.push('image'); },
          async saveAsync() {
            if (saveFails) throw Error('conversion interrupted');
            entries.set('file:///cache/generated.jpg', { size: 10, md5: 'converted-hash' });
            return { uri: 'file:///cache/generated.jpg' };
          },
        }; },
      }; } },
    },
  });
  return { files, entries, deleted, events, released, asset: { uri: 'file:///picked/original', mimeType: mime, fileName: 'original.heic' } };
}

test('preparing a supported photo copies bytes to documents without moving or deleting its source', async () => {
  const h = fileHarness();
  const prepared = await h.files.prepareAsset(h.asset);
  assert.equal(prepared.localName, 'owned-copy.jpg');
  assert.equal(h.entries.has(h.asset.uri), true);
  assert.equal(h.entries.has('file:///documents/uploads/owned-copy.jpg'), true);
  assert.deepEqual(h.deleted, []);
  assert.equal(prepared.fileHash, 'ciiya-mobile:original-hash:10');
});

test('HEIC conversion cleans only its generated temporary output and releases native handles', async () => {
  const h = fileHarness({ mime: 'image/heic' });
  const prepared = await h.files.prepareAsset(h.asset);
  assert.equal(prepared.mimeType, 'image/jpeg');
  assert.equal(h.entries.has(h.asset.uri), true);
  assert.deepEqual(h.deleted, ['file:///cache/generated.jpg']);
  assert.deepEqual(h.released, ['image', 'context']);
});

test('a failed conversion keeps the source and releases both native handles', async () => {
  const h = fileHarness({ mime: 'image/heic', saveFails: true });
  assert.equal(await h.files.prepareAsset(h.asset), null);
  assert.equal(h.entries.has(h.asset.uri), true);
  assert.deepEqual(h.deleted, []);
  assert.deepEqual(h.released, ['image', 'context']);
});

test('a partial copy failure deletes only the queue-owned copy, never the source', async () => {
  const h = fileHarness({ copyFails: true });
  assert.equal(await h.files.prepareAsset(h.asset), null);
  assert.equal(h.entries.has(h.asset.uri), true);
  assert.deepEqual(h.deleted, ['file:///documents/uploads/owned-copy.jpg']);
});

test('the replacement queue is fully written before replacing the previous journal', () => {
  const h = fileHarness();
  h.files.saveQueue('{"version":1,"items":[]}');
  assert.deepEqual(h.events, ['write:queue.next.json', 'replace:queue.json']);
  assert.equal(h.files.queueFile().textSync(), '{"version":1,"items":[]}');
});

test('local cleanup cannot escape the app-owned upload directory', () => {
  const h = fileHarness();
  h.files.deleteLocalFile('../picked/original');
  assert.throws(() => h.files.localFile('../picked/original'));
  assert.deepEqual(h.deleted, []);
  assert.equal(h.entries.has(h.asset.uri), true);
});
