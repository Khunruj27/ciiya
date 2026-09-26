# Phase 14.5 — Ciiya Sync

Ciiya Sync is the Lightroom companion for Ciiya. It is an additive integration
between the completed R2 rollout (Phase 14) and delayed Supabase-source cleanup
(Phase 15). It does not change Supabase Auth, PostgreSQL, Realtime, Stripe,
subscriptions, Albums, Photos, Face data, jobs, or the storage adapter.

## Product flows

### Live Folder

1. A camera captures into Lightroom Classic through tethered capture.
2. Lightroom applies the photographer's Develop preset.
3. Lightroom exports a rendered JPEG into a local session folder.
4. Ciiya Sync waits until the file is stable, queues it locally, hashes it, and
   uploads it to the selected Ciiya album.
5. The existing R2 finalizer, Photo Worker, Face Worker, and Realtime Gallery
   complete the normal Ciiya pipeline.

Ciiya Sync never claims the USB camera while Lightroom owns it. Camera Live
Import remains a separate workflow and must not run for the same tethered
camera at the same time.

### Export Selection

1. The photographer selects edited photos in Lightroom.
2. Lightroom exports each rendered JPEG to the chosen local archive folder.
3. The same exported file is uploaded to the chosen Ciiya album.
4. The local file is retained. Ciiya never moves or deletes it by default.

## Security model

- The desktop app opens a browser with an eight-character, ten-minute pairing
  code.
- The signed-in owner approves the device in Ciiya.
- The polling secret and final device token are high-entropy random values.
- PostgreSQL stores SHA-256 hashes only; raw credentials are returned once.
- Device tokens expire after 90 days, are scoped, and can be revoked.
- The app never receives R2 credentials, the Supabase service-role key, or the
  user's Supabase refresh token.
- Every album and future upload request remains bound to the paired owner.

## Implementation tracker

| Subphase | Scope | Status |
| --- | --- | --- |
| 14.5.1 | Pairing schema, scoped device identity, album discovery, approval UI | Complete; verified in Production |
| 14.5.2 | Device management and revocation in Me | Complete; ownership/revocation contract verified |
| 14.5.3 | Device-authenticated R2 upload reservation/finalization | Complete; verified in Production |
| 14.5.4 | Local queue, stable-file watcher, retries, offline recovery | Complete; offline restart recovery verified |
| 14.5.5 | Ciiya Sync desktop shell for macOS and Windows | Complete for internal canary |
| 14.5.6 | Lightroom Export Selection integration and local-copy workflow | Complete; verified in Production |
| 14.5.7 | Live Folder session UI, Realtime status, telemetry | Complete; verified locally |
| 14.5.8 | Release channels, canary, rollback, and installers | Complete for unsigned internal canary; public signing remains optional/deferred |

## Subphase 14.5.1

### Files

- `supabase/migrations/202609230002_ciiya_sync_foundation.sql`
- `supabase/schema.sql`
- `src/lib/ciiya-sync/server.ts`
- `src/app/api/ciiya-sync/pairing/start/route.ts`
- `src/app/api/ciiya-sync/pairing/approve/route.ts`
- `src/app/api/ciiya-sync/pairing/status/route.ts`
- `src/app/api/ciiya-sync/albums/route.ts`
- `src/app/connect/ciiya-sync/page.tsx`
- `src/components/ciiya-sync-connect-form.tsx`
- `src/app/login/page.tsx`
- `src/components/login-form.tsx`

### Previous behavior

Ciiya authenticated browser sessions and server workers, but had no durable
identity for a local Lightroom companion. A local app could not safely discover
the owner's albums without receiving a user session or a privileged secret.

### New behavior

A local app can request a short-lived pairing code, poll with an independent
secret, and receive a revocable scoped token only after the signed-in owner
approves the code. The token can read a compact list of albums belonging to its
owner. Login now preserves a safe same-origin return path so pairing can resume
after authentication.

This subphase alone did not authorize uploads. Subphase 14.5.3 now activates
the existing `photos:upload` scope through device-bound upload sessions.

### Risks and rollback

- Risk: pairing-code guessing. Mitigated by 40 bits of unambiguous random code,
  a ten-minute expiry, separate high-entropy poll secret, and distributed rate
  limits.
- Risk: a leaked device token. Mitigated by hash-only storage, 90-day expiry,
  scopes, owner checks, and revocation-ready device rows.
- Risk: disrupting current uploads. Mitigated by additive tables and routes;
  no existing upload, camera, worker, or storage code path is changed.
- Rollback: remove the Ciiya Sync routes/UI and drop the two additive tables and
  functions. Existing photos and objects are unaffected.

### Validation

- Ciiya Sync foundation contract test: passed
- Environment coverage: passed (80 referenced variables documented)
- ESLint for changed files: passed with no warnings
- TypeScript and Next.js route type generation: passed
- Next.js production build: passed
- Pairing API smoke test: pending until the additive migration is applied to a
  non-production environment

## Upload invariants for 14.5.3

The desktop client must not create a parallel storage implementation. It will
reuse the existing sequence:

`reserve quota → signed R2 PUT → HEAD/size verification → finalize → Photo Job`

The local queue will supply a stable `clientUploadId` and SHA-256 hash. Lightroom
has already rendered Develop settings into the exported JPEG, so Ciiya must not
apply an XMP preset a second time. Source metadata will identify
`ciiya-sync-live-folder` or `ciiya-sync-export-selection` without requiring a
new photos table.

## Subphase 14.5.2

### Files

- `src/app/api/ciiya-sync/devices/route.ts`
- `src/app/me/ciiya-sync/page.tsx`
- `src/components/ciiya-sync-devices.tsx`
- `src/app/me/page.tsx`
- `scripts/test-ciiya-sync-foundation.ts`

### Previous behavior

The owner could approve a pairing, but there was no account screen showing
which computers held an active Ciiya Sync token and no owner-facing revocation
action.

### New behavior

`Me > Ciiya Sync` lists every paired computer with its platform, application
version, last activity, token status, and revocation state. The owner can
disconnect an active device. The server authenticates the browser user and
updates only a device whose `owner_id` matches that user. Existing device-token
authentication already rejects a row as soon as `revoked_at` is set, so the
revocation applies to the next request without waiting for token expiry.

The operation is idempotent: disconnecting an already revoked device returns
success, while an ID outside the owner's account returns `DEVICE_NOT_FOUND`.
The device can be restored only by completing a new pairing, which rotates its
token hash.

### Risks and rollback

- Risk: revoking another owner's device. Mitigated by browser authentication
  plus an owner filter on both the update and fallback lookup.
- Risk: a stolen token continues working after revocation. Mitigated by the
  `revoked_at is null` predicate in every device-authenticated request.
- Risk: accidental disconnection. Mitigated by an explicit confirmation; the
  recoverable path is to pair the computer again.
- Rollback: remove the page, menu item, and devices API. No table or token
  migration is required beyond the additive 14.5.1 schema.

### Validation

- Device ownership and revocation contract checks: passed
- Storage schema regression contract: passed
- Environment coverage: passed (80 referenced variables documented)
- ESLint for changed files: passed with no warnings
- TypeScript and Next.js route type generation: passed
- Next.js production build: passed

## Subphase 14.5.3

### Files

- `supabase/migrations/202609230003_ciiya_sync_upload.sql`
- `supabase/schema.sql`
- `src/lib/photo-upload-principal.ts`
- `src/app/api/photos/upload-url/route.ts`
- `src/app/api/photos/finalize-upload/route.ts`
- `scripts/test-ciiya-sync-foundation.ts`

### Previous behavior

A paired device could list the owner's albums, but the existing photo upload
endpoints accepted only a Supabase browser session. Giving the desktop app a
user refresh token or a privileged R2/Supabase credential would have expanded
its authority beyond the scoped Ciiya Sync model.

### New behavior

The existing photo endpoints now accept either the browser session or a valid
Ciiya Sync bearer token with `photos:upload`. The device follows the same
pipeline as the web uploader:

`quota reservation → signed R2 PUT → HEAD/size/type verification → photo row → Photo Worker`

The server derives the owner from the stored device token hash, checks album
ownership, generates the object key, and returns only a short-lived signed PUT
URL. PostgreSQL records `ciiya_sync_device_id` on the upload session. Reserve,
cancel, begin-finalization, and complete-finalization RPCs require that exact
active device, so another account or another paired computer cannot take over
the session.

Ciiya Sync accepts only R2 uploads. It cannot provide an XMP preset because
Lightroom has already rendered the Develop settings. The finalizer records one
of three allowlisted sources: `ciiya-sync`, `ciiya-sync-live-folder`, or
`ciiya-sync-export-selection`. Browser Upload and Camera Live Import continue
to use their original authentication and RPCs.

### Desktop request contract

All server requests use:

```http
Authorization: Bearer ciiya_sync_<device-token>
```

1. `POST /api/photos/upload-url` with `albumId`, stable `clientUploadId`,
   filename, MIME type, byte size, SHA-256 `fileHash`, and requested size.
2. Upload the unchanged bytes to the returned R2 URL with the returned method
   and headers.
3. `POST /api/photos/finalize-upload` with the returned provider, bucket,
   object path, session ID, matching file details, and an allowlisted
   `uploadSource`.
4. If the local queue abandons a reservation, call
   `DELETE /api/photos/upload-url` with its `uploadSessionId`.

`clientUploadId` and `fileHash` make retries idempotent. The raw device token,
R2 credentials, and service-role key are never stored in photo metadata or
sent to R2.

### Risks and rollback

- Risk: a device accesses another owner's album. Mitigated by deriving the
  owner from the active device row and repeating the owner check in SQL.
- Risk: one paired computer finalizes another computer's upload. Mitigated by
  binding each session to `ciiya_sync_device_id` in every service-role RPC.
- Risk: a retry creates duplicate photos. Mitigated by the existing stable
  `clientUploadId`, file hash lookup, and idempotent finalization behavior.
- Risk: Lightroom edits are applied twice. Mitigated by rejecting `presetPath`
  for Ciiya Sync and storing a null preset on the reservation.
- Rollback: stop sending device tokens to the photo endpoints and remove the
  new resolver branches/RPCs. Browser and Camera upload sessions remain valid;
  the additive session column can remain nullable.

### Validation

- Device upload contract test: passed
- Full storage regression suite (adapter through Phase 15 and worker lifecycle): passed
- ESLint for changed upload files: passed with no warnings
- TypeScript and Next.js route type generation: passed
- Next.js production build: passed
- Real R2 upload smoke test: pending until both Ciiya Sync migrations are
  applied to a non-production environment

## Subphase 14.5.4

### Files

- `src/lib/ciiya-sync/local/types.ts`
- `src/lib/ciiya-sync/local/queue-store.ts`
- `src/lib/ciiya-sync/local/stable-file-watcher.ts`
- `src/lib/ciiya-sync/local/upload-client.ts`
- `src/lib/ciiya-sync/local/sync-engine.ts`
- `src/lib/ciiya-sync/local/index.ts`
- `scripts/test-ciiya-sync-local-queue.ts`
- `package.json`

### Previous behavior

The server could pair and revoke a computer and could authorize that device to
reserve and finalize an R2 upload. There was no local durable queue, no safe way
to decide that Lightroom had finished writing an exported image, and no
automatic recovery after a network interruption or app restart.

### New behavior

The platform-neutral Ciiya Sync core now watches one selected Lightroom export
folder, waits until an image's size and modification time have stopped changing,
and writes a durable local queue before uploading. It supports JPEG, PNG, and
WebP, ignores common temporary/partial files, and watches only the selected
folder rather than recursively consuming local archive subfolders.

For each stable file the engine uses the existing 14.5.3 contract:

`stream SHA-256 → reserve quota → streamed signed R2 PUT → finalize → Photo Job`

The source image is never moved or deleted. A stable `clientUploadId`, file
hash, and persisted upload session make retries idempotent. If Ciiya Sync stops
after R2 accepts the object but before finalization succeeds, the next launch
resumes at finalization rather than uploading the bytes again. If Lightroom
changes the source while it is being read, the stale reservation is cancelled,
a new source version and upload ID are created, and the file returns to the
queue only after the stability delay.

Retryable network, timeout, rate-limit, and server errors use capped exponential
backoff with jitter. Retryable items have no fixed attempt limit by default, so
an offline event session continues when connectivity returns. Permanent API or
authorization errors stop as `failed` and can be retried explicitly after the
operator fixes the cause.

Queue writes use a restrictive local file mode and atomic temporary-file rename.
A damaged state file is quarantined instead of being overwritten. The raw
device token remains in process memory and is never serialized into queue state,
photo metadata, or the signed R2 request.

### Desktop integration contract

The 14.5.5 desktop shell will construct `CiiyaSyncEngine` with:

- the Ciiya production API base URL;
- a paired device token from the operating-system credential store;
- the owner-selected album and Lightroom export folder;
- an application-data path for `queue.json`;
- optional concurrency, stability, polling, and retry settings.

The engine exposes queue events plus explicit retry and cancel operations for
the desktop UI. Polling is the default for predictable behavior on external and
network volumes. The desktop shell can opt out when native filesystem events are
known to be reliable.

This subphase intentionally does not add a desktop binary or UI and does not
introduce a new database migration or environment variable. Those packaging and
credential-store responsibilities remain in 14.5.5.

### Risks and rollback

- Risk: uploading an incomplete Lightroom export. Mitigated by repeated size
  and modification-time checks, revalidation before and after R2 upload, and
  cancellation of the stale reservation when the source changes.
- Risk: duplicate photos after a crash. Mitigated by persisted upload state,
  stable upload IDs/hashes, existing server duplicate checks, and direct resume
  from `finalizing` when the object was already accepted.
- Risk: losing the queue during a write. Mitigated by serialized mutations,
  fsync, atomic rename, versioned state, and corrupt-file quarantine.
- Risk: exporting while offline. Mitigated by durable `retry_wait` state and
  capped exponential backoff; local source files are retained.
- Rollback: stop constructing the local engine and remove the local module. The
  additive pairing/upload APIs and every browser/camera/worker flow remain
  unchanged, and no remote object or database row is modified by rollback.

### Validation

- Local queue persistence, deduplication, permissions, and restart recovery: passed
- Stable-file multi-write detection: passed
- Device reserve → streamed signed R2 PUT → finalize contract: passed
- Device-token isolation from signed R2 requests and queue state: passed
- Source-mutation reservation cancellation: passed
- Simulated offline failure → backoff → successful recovery: passed
- Combined Ciiya Sync contract suite: passed
- Full storage regression suite (adapter through Phase 15 and worker lifecycle): passed
- ESLint for the local core and contract tests: passed with no warnings
- TypeScript and Next.js route type generation: passed
- Next.js production build: passed

## Subphase 14.5.5

### Files

- `desktop/ciiya-sync/build.mjs`
- `desktop/ciiya-sync/electron-builder.yml`
- `desktop/ciiya-sync/src/contracts.ts`
- `desktop/ciiya-sync/src/settings-store.ts`
- `desktop/ciiya-sync/src/api-client.ts`
- `desktop/ciiya-sync/src/main.ts`
- `desktop/ciiya-sync/src/preload.ts`
- `desktop/ciiya-sync/renderer/index.html`
- `desktop/ciiya-sync/renderer/styles.css`
- `desktop/ciiya-sync/renderer/renderer.js`
- `desktop/ciiya-sync/renderer/tray.svg`
- `desktop/ciiya-sync/assets/app-icon.svg`
- `desktop/ciiya-sync/assets/app-icon.png`
- `desktop/ciiya-sync/assets/app-icon.icns`
- `desktop/ciiya-sync/assets/app-icon.ico`
- `scripts/test-ciiya-sync-desktop.ts`
- `src/lib/ciiya-sync/local/sync-engine.ts`
- `package.json`
- `.gitignore`

### Previous behavior

The Ciiya Sync server and local engine were complete, but a photographer had no
desktop application that could pair the computer, choose an album and Lightroom
folder, securely retain the device credential, or control and inspect the local
queue.

### New behavior

Ciiya Sync now has an Electron desktop shell for macOS and Windows. The first
screen starts the existing device-code pairing flow and opens the trusted Ciiya
verification URL in the system browser. Once approved, the desktop app loads
only albums owned by that paired account. The photographer can select an album,
choose the Lightroom Export folder with the operating-system folder picker, and
start or pause Live Folder sync.

The dashboard shows active, completed, retrying, and failed counts plus the
latest queue items. Failed or cancelled items can be retried and in-progress
items can be cancelled. Closing the window leaves the application available in
the menu-bar/system-tray; explicitly quitting performs graceful engine shutdown.
If auto-start is enabled, a valid paired session resumes its selected folder and
album on the next app launch.

The renderer is a local static interface. It makes no network request directly,
has no Node.js access, and receives only allowlisted operations through the
preload bridge. Pairing, album requests, folder access, queue persistence, and
uploads remain in the main process.

### Credential and application security

- The raw device token is encrypted with Electron `safeStorage`, backed by the
  macOS Keychain or Windows DPAPI, and written separately from settings/queue.
- The renderer never receives the device token, R2 credentials, Supabase keys,
  or authorization headers.
- `contextIsolation`, renderer sandboxing, disabled Node integration, a strict
  Content Security Policy, blocked navigation, and denied popup creation are
  enabled.
- Only pairing URLs matching the configured Ciiya API origin can be opened in
  the external browser.
- A single-instance lock prevents two processes from writing the same local
  queue concurrently.

### Build and packaging

The desktop TypeScript is bundled separately from Next.js with esbuild. The
Electron application package contains only the self-contained Ciiya Sync bundle;
Web, Face Worker, Sharp, TensorFlow, and Supabase server dependencies are not
copied into the desktop application.

Development and verification commands:

```bash
npm run build:ciiya-sync:desktop
npm run dev:ciiya-sync:desktop
npm run pack:ciiya-sync:desktop
npm run test:ciiya-sync:desktop
```

Unsigned distribution targets are configured as macOS DMG for arm64/x64 and
Windows NSIS for x64/arm64. Production signing, notarization, installer canary,
and release rollback remain explicitly deferred to 14.5.8.

### Risks and rollback

- Risk: a compromised renderer reads credentials or the filesystem. Mitigated
  by the sandboxed preload/IPC boundary and by never returning the device token.
- Risk: a copied credential file works on another computer. Mitigated by OS-user
  encryption through Keychain/DPAPI and server-side device revocation/expiry.
- Risk: changing album or folder while uploads are active. The UI disables those
  controls while running and the main process enforces a stop before switching.
- Risk: desktop packaging accidentally includes Web/worker native dependencies.
  Mitigated by a dedicated generated application manifest and isolated builder
  project directory; packaged ASAR content is validated.
- Rollback: stop distributing/opening the desktop shell. The additive server
  APIs, browser upload, Camera Live Import, workers, and storage providers remain
  unchanged. Owners can revoke an installed desktop from `Me > Ciiya Sync`.

### Validation

- Settings persistence and encrypted credential isolation: passed
- Pairing pending → approval → album discovery contract: passed
- Renderer/preload security boundary checks: passed
- Desktop TypeScript bundle: passed
- Electron macOS arm64 unpacked packaging: passed
- Packaged ASAR contains only Ciiya Sync application files: passed
- Packaged Main → Preload → Renderer smoke test: passed
- macOS/Windows icons and installer target configuration: passed
- Combined Ciiya Sync server, local queue, and desktop suite: passed
- TypeScript typecheck: passed
- ESLint: passed with 6 pre-existing `next/no-img-element` warnings and no errors
- Full Web production build: passed
- Full R2/Supabase storage regression suite: passed

## Subphase 14.5.6

### Files

- `desktop/ciiya-sync/lightroom/CiiyaSync.lrplugin/Info.lua`
- `desktop/ciiya-sync/lightroom/CiiyaSync.lrplugin/BridgeConfig.lua`
- `desktop/ciiya-sync/lightroom/CiiyaSync.lrplugin/CiiyaBridge.lua`
- `desktop/ciiya-sync/lightroom/CiiyaSync.lrplugin/CiiyaExportServiceProvider.lua`
- `desktop/ciiya-sync/src/lightroom-bridge.ts`
- `desktop/ciiya-sync/src/lightroom-plugin.ts`
- `desktop/ciiya-sync/src/contracts.ts`
- `desktop/ciiya-sync/src/main.ts`
- `desktop/ciiya-sync/src/preload.ts`
- `desktop/ciiya-sync/renderer/index.html`
- `desktop/ciiya-sync/renderer/renderer.js`
- `desktop/ciiya-sync/renderer/styles.css`
- `desktop/ciiya-sync/build.mjs`
- `src/lib/ciiya-sync/local/sync-engine.ts`
- `scripts/test-ciiya-sync-lightroom.ts`
- `package.json`

### Previous behavior

Lightroom Classic could export into a watched Live Folder, but the photographer
could not choose a Ciiya album from Lightroom's Export dialog. Export Selection
also had no explicit two-copy workflow that retained the rendered file in a
photographer-selected archive folder while placing the same rendition in the
durable Ciiya upload queue.

### New behavior

The desktop app can install a Ciiya Sync Lightroom Classic export-service
plug-in into the current user's Lightroom Modules directory on macOS or Windows.
After restarting Lightroom Classic, `File > Export` offers `Ciiya Sync` as an
export destination. The plug-in loads only the paired owner's current albums,
lets the photographer choose one album and one local archive folder, and keeps
Lightroom's normal file naming, sizing, metadata, watermark, and sharpening
controls. The rendered output is constrained to JPEG/sRGB for the existing
photo pipeline.

For every successful rendition, the plug-in first copies the completed JPEG to
the selected archive folder with collision-safe naming. It then sends only the
absolute local path and selected album ID to the desktop app. The desktop app
stats the completed file, validates the type and owner-visible album, and adds
it to the existing durable queue as `ciiya-sync-export-selection`. The normal
device-authenticated reservation, direct R2 PUT, finalizer, Photo Worker, Face
Worker, Realtime Gallery, quota, retry, and duplicate checks remain unchanged.
The local archive file is never moved or deleted, including when the network or
queue request fails.

The queue processor now supports a processing-only mode without a filesystem
watcher. This allows Export Selection to upload and retry while Live Folder is
paused. Starting Live Folder replaces that processor with one watcher-backed
engine; pausing Live Folder restores the processing-only engine, so two upload
pumps never consume the same queue concurrently.

### Local bridge and security

- The bridge listens only on `127.0.0.1:51673` and is not exposed to the LAN.
- Every request requires a random 256-bit local bridge secret. The secret is
  stored with user-only permissions and is never returned to the renderer.
- The browser renderer cannot call the local HTTP bridge directly because the
  Content Security Policy keeps `connect-src 'none'`.
- The plug-in receives no Ciiya device token, Supabase session, R2 credential,
  signed URL, service-role key, or remote API URL.
- Album IDs are rechecked against the paired owner's latest album list before a
  path is accepted. Paths must be absolute, point to a completed non-empty file,
  and use a supported image extension.
- The bridge caps request bodies, disables caching, performs constant-time
  secret comparison, and returns a minimal URL-encoded line protocol so the
  Lightroom Lua runtime needs no third-party JSON dependency.
- Desktop shutdown is bounded: the bridge closes idle connections immediately,
  force-closes any remaining loopback sockets after one second, and the app
  finishes its quit sequence within five seconds even if a local client stalls.

### Risks and rollback

- Risk: another local process tries to enqueue arbitrary files. Mitigated by
  loopback binding, a private high-entropy secret, album ownership checks, and
  strict file/path validation.
- Risk: an existing archive filename is overwritten. Mitigated by adding a
  numeric suffix before copying; an existing file is never replaced.
- Risk: Ciiya Sync is closed during export. Lightroom keeps the local JPEG and
  reports that cloud queueing failed, so the photographer retains the result
  and can retry after reopening Ciiya Sync.
- Risk: queue corruption or duplicate uploads during mode changes. Mitigated by
  the existing atomic queue, stable upload IDs, server duplicate detection, and
  a single engine instance per desktop process.
- Rollback: remove or disable `CiiyaSync.lrplugin`. Live Folder, browser upload,
  Camera Live Import, database schema, and all existing storage providers remain
  unchanged. Local archive files and already queued photos remain intact.

### Validation

- Loopback bridge authentication, album encoding, enqueue contract: passed
- Bridge-secret persistence and user-only file permissions: passed
- Lightroom plug-in installation and generated bridge config: passed
- Processing-only queue → R2 → finalize with Export Selection source: passed
- Lightroom Export provider/local-copy static contract: passed
- Desktop bundle includes the Lightroom plug-in: passed
- Combined Ciiya Sync suite: passed
- Full Web production build and storage regression: passed
- Packaged macOS arm64 app contains the complete Lightroom plug-in: passed
- Packaged Electron lifecycle and loopback bridge smoke test: passed

## Subphase 14.5.7

### Files

- `desktop/ciiya-sync/src/session-telemetry.ts`
- `desktop/ciiya-sync/src/contracts.ts`
- `desktop/ciiya-sync/src/main.ts`
- `desktop/ciiya-sync/renderer/index.html`
- `desktop/ciiya-sync/renderer/renderer.js`
- `desktop/ciiya-sync/renderer/styles.css`
- `scripts/test-ciiya-sync-session.ts`
- `scripts/test-ciiya-sync-foundation.ts`
- `package.json`

### Previous behavior

The desktop shell showed a global queue summary and recent items, but it did not
separate one photography session from older queue history. Operators could not
see elapsed session time, the exact session album, delivery totals, the most
recent activity, or whether the computer had gone offline. Queue updates were
sent immediately for every persistence transition without coalescing closely
spaced UI refreshes.

### New behavior

Starting Live Folder now creates one explicit local session bound to the chosen
album. The compact session overview shows watching, syncing, waiting-for-network,
needs-attention, or paused state; elapsed time; selected album and folder label;
discovered and delivered photo counts; delivered bytes; current connectivity;
and the time of the latest queue activity. The counters update through the
existing Main → Preload → Renderer IPC channel as the durable queue moves through
hashing, reservation, R2 upload, and finalization.

Queue events are coalesced before renderer delivery so one image does not cause
several overlapping state snapshots. Electron's connectivity signal updates the
offline indicator every five seconds. An offline session keeps its durable
queue and clearly reports that work will continue when connectivity returns.
No alternate uploader, websocket, database table, or cloud event pipeline was
introduced.

Session telemetry is local and aggregate-only. The user-data file stores a
session ID, album ID, timestamps, status totals, byte totals, and opaque queue
item IDs. It never stores filenames, source paths, image content, hashes, device
tokens, signed URLs, R2 credentials, Supabase credentials, or authorization
headers. The file is written atomically with user-only permissions. Completed
history is capped at twenty sessions, and an active session left by an
unexpected exit is closed as interrupted before auto-start creates a new one.

Export Selection remains independent from Live Folder telemetry: it continues
through the processing-only queue without changing the current Live Session
counters. Existing photo processing, Face Worker, Realtime Gallery, quota,
subscription, and storage-provider behavior are unchanged.

### Risks and rollback

- Risk: rapid queue transitions cause renderer flicker or stale state. Mitigated
  by serialized state snapshots and a short coalescing window.
- Risk: an unexpected quit leaves a session appearing live. Mitigated by
  recovery that ends the previous session as `interrupted` before resume.
- Risk: operational telemetry leaks local filenames or credentials. Mitigated
  by an aggregate schema, restrictive file permissions, privacy contract tests,
  and keeping all telemetry on the paired computer.
- Risk: OS connectivity reports a link while the Ciiya endpoint is unavailable.
  The UI also treats queue retry state as waiting for network, while the existing
  retry policy remains the source of truth for delivery.
- Rollback: remove the session telemetry module and overview UI. The durable
  queue, Lightroom plug-in, R2 upload/finalize path, Live Folder watcher, and all
  server/database behavior continue without a migration or data conversion.

### Validation

- Aggregate session lifecycle, restart recovery, and twenty-session cap: passed
- Queue status/byte counters and album/source isolation: passed
- Telemetry privacy and user-only file permissions: passed
- Realtime IPC, connectivity, coalescing, and renderer contracts: passed
- Phase-specific TypeScript and ESLint checks: passed
- Combined Ciiya Sync suite: passed
- Desktop bundle, packaged ASAR contract, and lifecycle smoke test: passed
- Full Web production build and storage regression: passed
- Full ESLint: passed with 6 pre-existing `next/no-img-element` warnings and no errors

## Subphase 14.5.8

### Files

- `src/lib/ciiya-sync/rollout.ts`
- `src/lib/photo-upload-principal.ts`
- `src/app/api/ciiya-sync/albums/route.ts`
- `src/app/api/ciiya-sync/pairing/approve/route.ts`
- `src/app/api/photos/upload-url/route.ts`
- `src/app/api/photos/finalize-upload/route.ts`
- `desktop/ciiya-sync/entitlements.mac.plist`
- `desktop/ciiya-sync/electron-builder.yml`
- `desktop/ciiya-sync/build.mjs`
- `desktop/ciiya-sync/src/contracts.ts`
- `desktop/ciiya-sync/src/main.ts`
- `desktop/ciiya-sync/renderer/index.html`
- `desktop/ciiya-sync/renderer/renderer.js`
- `scripts/build-ciiya-sync-release-manifest.ts`
- `scripts/validate-ciiya-sync-release.ts`
- `scripts/test-ciiya-sync-release.ts`
- `.github/workflows/ciiya-sync-release.yml`
- `.env.example`
- `package.json`

### Previous behavior

Desktop bundles could be packaged locally, but there was no isolated signed
release workflow, notarization contract, checksum manifest, visible release
channel, owner canary gate, or server-side kill switch. Stopping distribution
would not immediately pause already installed clients.

### New behavior

Ciiya Sync now supports `development`, `canary`, and `stable` desktop channels.
The channel is compiled into the trusted Main process and displayed with the app
version. The dedicated release workflow creates macOS and Windows artifacts only
after the complete Ciiya Sync and TypeScript checks pass. macOS builds use
hardened runtime, explicit Electron entitlements, Developer ID signing, Apple
notarization, Gatekeeper assessment, and stapling validation. Windows builds use
SHA-256 Authenticode signing and validate the final installer signature. Each
job creates a JSON manifest containing only version, channel, relative artifact
path, byte size, and SHA-256 digest. No credential is written to the manifest or
uploaded artifact.

The Web/API deployment has an independent owner rollout gate:

- `CIIYA_SYNC_ROLLOUT_MODE=all` keeps the backward-compatible behavior.
- `CIIYA_SYNC_ROLLOUT_MODE=canary` permits only complete owner UUIDs in
  `CIIYA_SYNC_CANARY_OWNER_IDS` (comma-separated).
- `CIIYA_SYNC_ROLLOUT_MODE=off` pauses pairing approval, album discovery, upload
  reservation, cancellation, and finalization for desktop-device credentials.

The gate is evaluated only after a valid Ciiya Sync device token or authenticated
pairing owner has been established. Browser uploads, Camera Live Import, worker
finalization, Portfolio, Guest Moments, Face Worker, Photo Worker, R2 migration,
and the Supabase fallback remain outside this gate. A paused upload returns
`503 CIIYA_SYNC_ROLLOUT_PAUSED` with `Retry-After`. The desktop therefore keeps
the original local file and durable queue item in `retry_wait`; it does not mark
the photo failed, delete it, or reserve another provider.

### Signed release secrets

Configure release secrets in GitHub Actions only. Do not copy them to Vercel,
Railway, the desktop bundle, or a `NEXT_PUBLIC_` variable.

- macOS: `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
- Windows: `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`

Run `Ciiya Sync Signed Release` manually with channel `canary` first. The
workflow refuses to upload a release when signing, notarization/stapling,
Authenticode, checksum, typecheck, or Ciiya Sync validation fails.

For internal testing without Apple or Windows certificates, run
`Ciiya Sync Internal Canary`. It builds unsigned macOS and Windows installers,
runs packaged-app smoke tests on the matching native runner, verifies that the
embedded channel is `canary`, validates every checksum, and retains the
artifacts for 14 days. Unsigned artifacts remain internal-only and follow the
platform-specific manual-open instructions in `release/ciiya-sync/INTERNAL-TEST.md`.

### Canary runbook

1. In Vercel Production set `CIIYA_SYNC_ROLLOUT_MODE=canary` and add only the
   testing owner's full Supabase Auth UUID to `CIIYA_SYNC_CANARY_OWNER_IDS`.
   These variables are not needed by Railway Photo/Face Workers.
2. Redeploy Web/API, then run the signed release workflow with `canary`.
3. Install the signed artifact on a clean macOS/Windows account and verify app
   version/channel, pairing, album refresh, Live Folder, Export Selection local
   copy, offline retry, restart recovery, Photo Worker, Face Worker, Gallery,
   download, delete, device revocation, and that another owner cannot pair.
4. Compare `release-manifest.json` before distribution and observe server,
   worker, R2, quota, and queue metrics through a normal production work cycle.
5. Change the mode to `all` only after the observation window is accepted; build
   a separate `stable` artifact rather than relabelling the canary binary.

### Rollback

Set `CIIYA_SYNC_ROLLOUT_MODE=off` in Vercel Production and redeploy. Existing
desktop queues will stop at retry-safe API responses while local exports remain
available. Revoke a device separately only if its credential is suspected to be
compromised. Restore `canary` or `all` after the issue is fixed; the same queues
resume without a database or storage migration. A previous signed desktop
artifact may be redistributed independently because the server kill switch is
the source of truth.

### Validation

- Rollout parser, invalid-mode fail-closed behavior, and owner allowlist: passed
- Paused API response → durable `retry_wait` with source file retained: passed
- Browser/worker paths remain outside the desktop rollout gate: contract passed
- Release manifest path, byte size, SHA-256, and secret-exclusion checks: passed
- Packaged `app.asar` channel matches the `canary` manifest: passed
- macOS entitlements/notarization and Windows SHA-256 signing config: passed
- Dedicated signed and unsigned internal release workflows/static secret
  boundary: passed
- macOS arm64/x64 DMG and Windows x64/arm64/combined NSIS installers: built
- Packaged macOS canary app launch and graceful-shutdown smoke test: passed
- Production Export Selection → R2 → Photo Worker → Face Worker with retained
  local copy: passed
- Offline retry followed by restart recovery from the same durable queue: passed
- Real Developer ID notarization and Windows Authenticode: pending the first
  credentialed GitHub `canary` workflow run; the workflow is intentionally
  fail-closed and cannot be truthfully marked passed without those certificates

## Phase 14.5 closeout — 2026-09-26

All eight subphases are complete for the unsigned internal canary. Production
validation covers pairing, device-scoped album discovery, direct R2 upload,
finalization, Photo Worker, Face Worker, Gallery delivery, Live Folder, and
Lightroom Export Selection while retaining the exported local file. Offline and
restart recovery, bounded app shutdown, release-channel integrity, installer
checksums, and macOS packaged-app launch were also verified.

The application remains in owner-scoped canary mode. Public distribution
signing/notarization is deliberately deferred and does not block internal use.
The native Windows packaged smoke test is enforced by the internal-canary GitHub
workflow because the local development machine is macOS.

## Phase 15 boundary

Ciiya Sync does not enable migration apply or Supabase source cleanup. Keep:

- `STORAGE_MIGRATION_APPLY_ENABLED=false`
- `STORAGE_SOURCE_CLEANUP_APPLY_ENABLED=false`

until the existing Phase 15 retention and canary requirements are independently
satisfied.
