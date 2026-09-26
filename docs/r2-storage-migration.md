# Ciiya storage migration: Supabase Storage to Cloudflare R2

This document is the implementation log and rollback record for the storage
layer migration. Supabase Auth, PostgreSQL, Realtime, Stripe, subscriptions,
and the existing Album/Photo/Face/Job models remain unchanged unless a phase
explicitly records an additive compatibility field.

## Safety rules

- Existing objects remain readable from Supabase throughout the migration.
- New R2 traffic is enabled only behind an explicit rollout gate.
- A database row is switched to `r2` only after every referenced object is
  copied and verified.
- Copy and cleanup are separate operations. Migration never deletes the
  Supabase source object.
- Original photos, presets, and private generated downloads are never exposed
  by the public delivery URL.
- Each phase must pass environment checks, typecheck, build, and relevant
  tests before it can be marked complete.

## Phase tracker

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | R2/S3 dependencies and environment configuration | Complete |
| 2 | Provider-neutral storage adapter | Complete |
| 3 | Additive dual-provider database fields | Complete and deployed |
| 4 | New browser uploads to R2 with presigned PUT | Complete and deployed |
| 5 | Provider-aware upload finalization | Complete and deployed |
| 6 | Photo Worker and Face Worker | Complete and deployed |
| 7 | Downloads and lazy derivative generation | Complete and deployed |
| 8 | Photo/album deletion and retryable partial failures | Complete and deployed |
| 9 | Camera Live Import Worker | Complete and deployed |
| 10 | Portfolio, Guest Moments, covers, and XMP presets | Complete and deployed |
| 11 | Storage consistency and orphan cleanup | Complete and deployed; destructive cleanup disabled |
| 12 | Dual-provider read-path audit | Complete and deployed |
| 13 | Supabase-to-R2 migration and verification tools | Complete; Production migration verified |
| 14 | Production canary validation | Complete; full R2 rollout enabled |
| 14.5 | Ciiya Sync Lightroom companion | Implemented; signed production canary pending |
| 15 | Delayed Supabase Storage cleanup | Retention active; source deletion not started |

## Production rollout record

On 22 September 2026, the Production migration completed with all 24 tracked
photos using R2 and no failed or in-flight migrations. Album, Public Share,
Face Search, download, Portfolio, Guest Moments, XMP preset, and Camera Live
Import smoke tests passed. The owner canary allowlist was then cleared in the
Vercel web application and both Railway worker services, enabling the full R2
upload rollout. Vercel returned to `Ready` and both Railway services returned
to `Online` after deployment.

The post-rollout read-only consistency audit checked 130 tracked objects: all
130 were healthy, with no missing objects, size mismatches, skipped checks, or
open consistency issues. Photo and face queues were empty and the system
health check was `HEALTHY`.

Phase 15 remains intentionally non-destructive. Twelve migrated photo rows are
in `retained` state, none are currently due, and the earliest source-cleanup
timestamp is 22 October 2026 at 04:25 UTC (11:25 Asia/Bangkok). Migration apply,
generic destructive cleanup, and Supabase source-cleanup gates remain disabled.
Retained Supabase objects must not be deleted before the retention gate opens
and the bounded Phase 15 canary dry-run passes.

## Phase 1

### Files

- `package.json` and `package-lock.json`
- `.env.example`
- `src/lib/storage/config.ts`
- `docs/r2-storage-migration.md`

### Previous behavior

The application had no R2 S3 client dependency and no validated R2 server
configuration. Supabase remained the only configured object store.

### New behavior

The repository includes the AWS S3-compatible client and presigner used by R2.
R2 configuration is documented and can be validated lazily by server and
worker code. `STORAGE_DEFAULT_PROVIDER` defaults to `supabase`, so this phase
does not change upload, read, delete, or worker traffic.

### Risks and rollback

- Risk: dependency or TypeScript/build incompatibility.
- Risk: an invalid endpoint or bucket name being accepted.
- Mitigation: configuration validation is lazy and R2 is not activated here.
- Rollback: remove the two AWS SDK packages, R2 environment entries, and the
  configuration module. No database or stored object rollback is required.

### Validation

- `.env.example` coverage: passed (53 referenced variables documented)
- TypeScript: passed
- R2 safe-default runtime check: passed (`supabase` remains the default)
- Next.js production build: passed
- Playwright API contracts: 5 passed
- Production dependency audit: 0 vulnerabilities

The local validation shell runs Node 20 while the repository declares Node 24.
`npm` emitted the existing engine warning, but typecheck, build, and tests all
completed successfully. Production should continue to use the declared Node 24
runtime.

During validation, `npm audit` identified the pre-existing `adm-zip` 0.6.0
override used by the optional TensorFlow Face Worker dependency. The override
was updated to the patched 0.6.1 release and the audit was rerun successfully.

## Phase 2

### Files

- `src/lib/storage/types.ts`
- `src/lib/storage/paths.ts`
- `src/lib/storage/supabase.ts`
- `src/lib/storage/r2.ts`
- `src/lib/storage/index.ts`
- `scripts/test-storage-adapter.ts`
- `package.json`

### Previous behavior

Application routes and workers called Supabase Storage directly and repeated
path, bucket, URL, and error-handling rules in each caller.

### New behavior

A provider-neutral adapter exposes upload, download, delete, batch delete,
object metadata/HEAD, signed upload, signed download, and guarded public URL
operations for both Supabase and R2. Central path builders preserve the current
`owner/album/tier/object.ext` layout while using UUIDs as object identifiers.

Only preview, thumbnail, cover, Portfolio, and Guest Moment keys can produce a
public URL. Original photos, presets, delivery files, and generated downloads
remain private by default. No existing route or worker uses the new adapter in
this phase, so live storage traffic remains unchanged.

`R2_PUBLIC_BASE_URL` must point to a delivery gateway (for example, a
Cloudflare Worker) that independently enforces the same public-prefix
allowlist. The R2 bucket itself must remain private; pointing this setting at a
fully public bucket or raw custom domain would make every object in that bucket
public regardless of application code.

### Risks and rollback

- Risk: accepting traversal or a key owned by another user/album.
- Risk: accidentally returning a public URL for a private object class.
- Risk: losing per-object failure information during batch deletion.
- Mitigation: centralized strict validation, a public-prefix allowlist, and
  structured batch-delete results.
- Rollback: remove the adapter modules and test script. No database, object, or
  production traffic rollback is required.

### Validation

- Storage adapter contract checks: passed
- Strict path/ownership/private-delivery checks: passed
- Supabase 404 versus service-failure behavior: passed
- R2 HEAD and signed-URL validation: passed
- `.env.example` coverage: passed (53 referenced variables documented)
- TypeScript: passed
- ESLint for Phase 2 files: passed with no warnings
- Full application ESLint: passed with 6 pre-existing `<img>` warnings
- Next.js production build: passed
- Playwright API contracts: 10 passed across desktop and mobile projects
- Production dependency audit: 0 vulnerabilities

Cloudflare's current R2 documentation confirms that presigned URLs support a
1-second to 7-day expiry and that `PutObject` supports `If-None-Match`. The
adapter applies both constraints and returns the required signed request
headers to callers.

## Phase 3

### Files

- `supabase/migrations/202609210001_photo_storage_provider_metadata.sql`
- `supabase/schema.sql`
- `src/lib/storage/types.ts`
- `scripts/test-storage-schema.mjs`
- `package.json`

### Previous behavior

`photos` stored object paths and URLs but did not identify the storage
provider, provider bucket, key-layout version, or Supabase-to-R2 copy state.
All existing readers therefore inferred Supabase buckets from each path.

### New behavior

Four additive fields are available on the existing `photos` table:

- `storage_provider` defaults to `supabase`.
- `storage_bucket` remains nullable for legacy Supabase rows because a single
  photo can have objects in both `albums` and `originals`.
- `storage_version` defaults to `1`.
- `migration_status` defaults to `pending` and accepts `pending`, `copying`,
  `verifying`, `completed`, or `failed`.

R2 rows must name a valid bucket. A compact partial index supports the future
migration queue without indexing completed rows. Existing insert paths omit the
new fields and therefore retain their exact Supabase behavior.

The migration validates temporary `NOT NULL` checks before applying column
nullability, reducing the duration of the write-blocking metadata lock. It
does not create a new photo table, change quota triggers, or modify RLS.

### Risks and rollback

- Risk: assigning one Supabase bucket to legacy rows would break originals
  already relocated to `originals`.
- Risk: invalid provider/status values could make dual-provider reads
  ambiguous.
- Risk: constraints and the partial index require a bounded migration lock.
- Mitigation: legacy bucket stays `NULL`, values are backfilled before
  validation, and permanent checks are added as `NOT VALID` then validated.
- Rollback before any R2 row exists: drop the partial index, constraints, and
  four additive columns. Stored objects and existing URL/path fields remain
  untouched.

No upload-session table is added in this phase. Its final fields must follow
the authenticated signed-upload API contract in Phase 4 so unused security or
quota state is not introduced prematurely.

### Validation

- Storage adapter and schema contract checks: passed
- Migration safety checks (no table/column drop, no photo delete, no legacy
  bucket-wide backfill): passed
- TypeScript: passed
- ESLint for storage and schema-test files: passed with no warnings
- Full application ESLint: passed with 6 pre-existing `<img>` warnings
- `.env.example` coverage: passed (53 referenced variables documented)
- Next.js production build: passed
- Playwright API contracts: 10 passed across desktop and mobile projects

The linked Supabase CLI dry-run was stopped after it remained at
`Initialising login role`; it did not apply a migration or change the remote
database. This migration is committed as application code only and must be
applied through the normal reviewed deployment process before Phase 4 is
enabled.

## Phase 4

### Files

- `supabase/migrations/202609210002_r2_photo_upload_sessions.sql`
- `supabase/schema.sql`
- `src/app/api/photos/upload-url/route.ts`
- `src/lib/storage/photo-upload-policy.ts`
- `src/components/upload-photo-form.tsx`
- `src/components/upload-photo-modal.tsx`
- `src/app/albums/[id]/page.tsx`
- `next.config.ts`
- `.env.example`
- `docs/r2-cors-policy.example.json`
- `scripts/test-storage-adapter.ts`
- `scripts/test-storage-schema.mjs`
- `e2e/api-contracts.spec.ts`

### Previous behavior

The browser uploaded every new album photo directly to the public-facing
Supabase `albums` bucket and then called the existing finalizer. Quota was
checked only during finalization, so several concurrent browser uploads could
all transfer before the final quota decision. R2 had no authenticated upload
session, ownership-bound key reservation, cancellation path, or progress-aware
browser PUT flow.

### New behavior

When both server-side gates are enabled, the album page requests an upload URL
from `/api/photos/upload-url`. The route authenticates the user, verifies album
ownership, validates category/preset/file metadata, performs an early duplicate
check, loads the existing subscription-backed storage plan, and calls a
security-definer reservation RPC. That RPC serializes quota decisions per user
with a transaction advisory lock and includes all active reservations when
checking the existing `user_storage_usage` limit.

The server creates a UUID-based key under
`{ownerId}/{albumId}/original/{objectId}.ext` and returns a ten-minute presigned
PUT URL. The browser uploads directly to R2 with XHR progress, retries transient
failures, and passes the provider, bucket, object key, and upload-session ID to
the existing finalizer contract prepared for Phase 5. Cancelling or failing an
upload releases the reservation and attempts an idempotent R2 object cleanup.
Reservations expire after fifteen minutes, so an interrupted browser cannot
hold quota indefinitely.

This phase is deliberately inactive by default. It requires both
`STORAGE_DEFAULT_PROVIDER=r2` and `R2_UPLOADS_ENABLED=true`; otherwise the
existing Supabase upload flow is unchanged. Do not enable the gate until the
Phase 3–5 migrations are deployed, R2 CORS is configured, and the Phase 6
provider-aware Photo Worker is live. XMP presets remain on Supabase until Phase
10.

Cloudflare R2 requires bucket CORS for browser presigned PUT requests. Apply a
production-specific version of `docs/r2-cors-policy.example.json`, replacing
the placeholder origin and retaining only trusted Ciiya origins. The signed
`Content-Type`, `Cache-Control`, and `If-None-Match` headers must match the
browser request.

### Risks and rollback

- Risk: enabling Phase 4 before Phase 5 would upload an object that the current
  Supabase-only finalizer cannot verify.
- Risk: concurrent uploads could overrun quota without an atomic reservation.
- Risk: a user could request a key for another owner or album.
- Risk: a failed browser request could leave an unreferenced object.
- Mitigation: double server-side rollout gate, ownership checks in both route
  and RPC, per-user advisory locking, strict owner/album key prefixes,
  short-lived signatures, unique client upload IDs, expiry, and cancellation
  cleanup. The later consistency phase remains responsible for rare orphan
  cleanup after a hard browser disconnect.
- Rollback: set `R2_UPLOADS_ENABLED=false`. New browser traffic immediately
  returns to the existing Supabase path. The additive session table can remain
  in place; it does not change existing photo rows or quota accounting.

### Validation

- Storage adapter and upload-policy contract checks: passed
- Upload-session migration/schema safety checks: passed
- Anonymous upload-URL API rejection: passed on desktop and mobile
- API contract suite: 10 passed
- `.env.example` coverage: passed (53 referenced variables documented)
- TypeScript: passed
- ESLint for Phase 4 files: passed with no warnings
- Next.js production build: passed
- `git diff --check`: passed

The production build initially could not reach Google Fonts in the restricted
sandbox. It was rerun with network access and completed successfully. No remote
Supabase migration, R2 configuration, upload, commit, or deployment was
performed in this phase.

## Phase 5

### Files

- `supabase/migrations/202609210003_r2_photo_upload_finalization.sql`
- `supabase/schema.sql`
- `src/app/api/photos/finalize-upload/route.ts`
- `src/components/upload-photo-form.tsx`
- `.env.example`
- `scripts/test-storage-schema.mjs`
- `e2e/api-contracts.spec.ts`

### Previous behavior

`/api/photos/finalize-upload` assumed every original existed in the Supabase
`albums` bucket. It listed that bucket to check existence, created a Supabase
public URL for the original, inserted the photo, and queued a Supabase-oriented
photo job. It could not validate an R2 reservation, inspect R2 object metadata,
or distinguish a safe retry from a second finalization request.

### New behavior

The existing Supabase branch remains available and keeps its previous request
contract. An R2 request must also provide its upload-session ID, provider, and
bucket. The authenticated finalizer claims that session through a row-locked
RPC and then treats the server-side reservation—not browser fields—as the
canonical owner, album, key, filename, file hash, size, category, preset, and
requested output size.

Before inserting a photo, the route verifies the strict owner/album/original
key prefix and performs an R2 HEAD request through the Storage Adapter. The
object must exist and its `Content-Length` and `Content-Type` must exactly match
the reservation. R2 originals remain private: no public or original URL is
created for them. The photo row records `storage_provider = 'r2'`, the R2
bucket, storage version 1, and `migration_status = 'completed'`.

After the row is saved, a second security-definer RPC verifies the complete
photo/session binding and changes the session from `finalizing` to `completed`.
Repeated requests return the already completed photo, while a retry after a
lost response can bind the existing matching row without creating another
photo. Job payloads now carry provider and bucket hints for the provider-aware
worker implemented in Phase 6.

The R2 browser-upload rollout gate remains disabled. Enabling it before Phase 6
would queue a valid R2 photo for the current Supabase-only Photo Worker.

### Risks and rollback

- Risk: a forged finalization request could point at another owner's object.
- Risk: an incomplete PUT could create a photo row with the wrong size or type.
- Risk: a network retry could create two photos or bind one session twice.
- Risk: making an original URL public would bypass album permissions.
- Mitigation: authenticated session ownership, row locks, strict binding RPCs,
  owner/album path validation, R2 HEAD verification, the existing unique
  album/hash index, idempotent completion, and private original URLs.
- Rollback: leave `R2_UPLOADS_ENABLED=false` and revert the provider branch.
  Supabase uploads use their existing code path. The additive RPCs can remain
  installed without affecting any Supabase photo.

### Validation

- Upload-finalization migration/schema contract checks: passed
- TypeScript: passed
- Phase 5 ESLint: passed with no warnings
- Anonymous upload and finalization API contracts: passed on desktop and mobile
- Existing Supabase request contract remains unchanged; the authenticated
  mutating core flow requires dedicated E2E credentials and was not run here
- Next.js production build: passed
- `git diff --check`: passed

No remote migration, live R2 HEAD request, commit, deployment, or rollout-gate
change was performed in this phase.

## Phase 6

### Files

- `workers/photo-worker.ts`
- `workers/face-worker.ts`
- `src/lib/storage/photo-worker-plan.ts`
- `scripts/test-photo-worker-storage.ts`
- `package.json`
- `.env.example`

### Previous behavior

The Photo Worker always downloaded originals from Supabase `albums`, falling
back to `originals`, uploaded every derivative to Supabase `albums`, and moved
many processed originals into the private Supabase `originals` bucket. The
Face Worker also always downloaded its scan input from Supabase `albums`.
Consequently, a correctly finalized R2 photo could enter the existing queue
but could not be processed or face-scanned.

### New behavior

Both workers now load the canonical photo row before object I/O and select the
Storage Adapter from `storage_provider`. The row's owner, album, provider,
bucket, and original path are validated against the claimed job, so stale job
payloads cannot redirect processing to another user's object.

For an R2 photo, the Photo Worker downloads the private original through the
adapter and keeps it in place. It always creates a separate public-delivery
`preview/` object plus `thumbnail/`, and creates the selected private
`sd/hd/uhd` derivative when requested. An album configured for original
download still uses a resized display preview; the original is never exposed
through `public_url` or `original_url`. The photo row records derivative paths,
public preview/thumbnail URLs, byte sizes, and the existing processing state.

Supabase photos retain the legacy relocation and display rules during the
dual-provider period. Their storage operations now pass through the same
adapter, including the best-effort removal of a relocated public original.
XMP preset objects deliberately continue to be read from Supabase until Phase
10.

Face jobs carry provider/bucket hints for diagnostics, but the Face Worker
does not trust those hints. It reloads the photo row and downloads the scan
input from the matching provider through the adapter. This preserves face
search for both old Supabase photos and new R2 photos.

### Risks and rollback

- Risk: treating the R2 original as a public gallery image would expose a
  private asset.
- Risk: a stale queue payload could point at the wrong provider, owner, or
  album.
- Risk: enabling R2 without a guarded public delivery base would leave the
  gallery with no stable preview URL.
- Risk: deploying only one worker would let photo processing finish while face
  scanning still fails for R2.
- Mitigation: canonical database lookup, strict owner/album key validation,
  separate preview and private delivery keys, adapter-only R2 credentials, and
  a hard requirement for `R2_PUBLIC_BASE_URL` when processing R2 previews.
- Rollback: set `R2_UPLOADS_ENABLED=false` and roll both workers back together.
  Existing Supabase rows continue to use their previous object layout; already
  finalized R2 rows and objects remain intact for retry after redeployment.

### Validation

- Provider-specific Photo Worker object-plan checks: passed
- Storage adapter and schema contract checks: passed
- `.env.example` coverage: passed (53 referenced variables documented)
- TypeScript: passed
- ESLint for both workers and Phase 6 storage files: passed with no warnings
- Full application ESLint: passed with 6 pre-existing `<img>` warnings
- Production build: passed
- API contract suite: 10 passed across desktop and mobile projects
- `git diff --check`: passed

No remote migration, live R2 upload/download, commit, deployment, or
rollout-gate change was performed in this phase.

## Phase 7

### Files

- `src/lib/photo-download.ts`
- `src/lib/storage/photo-download-plan.ts`
- `src/app/api/photos/download/route.ts`
- `src/app/api/share/download-zip/route.ts`
- `scripts/test-photo-download-storage.ts`
- `package.json`

### Previous behavior

Photo downloads inferred the Supabase bucket from each path, downloaded every
object directly from Supabase Storage, and uploaded lazily generated SD, HD,
or UHD files back to the public Supabase `albums` bucket. The single-photo and
ZIP routes did not select `storage_provider` or `storage_bucket`, so an R2 photo
could not be resolved after processing.

### New behavior

Both download routes now load the photo provider and bucket. The shared
download resolver validates every candidate key against the photo owner and
album before selecting an adapter. Legacy Supabase originals retain their
`originals` then `albums` fallback; R2 uses only the exact bucket stored on the
photo row and never falls back across buckets.

Single-photo downloads continue through the existing authorized server proxy
after share-token, public-album, optional password, and download-policy checks.
This is the secure-proxy option for private R2 originals and avoids exposing an
object URL or credentials. ZIP downloads reuse the same resolver and therefore
have identical provider and permission behavior.

When the configured SD, HD, or UHD object is missing, the resolver downloads
the existing preset-baked display master, generates the requested JPEG with
Sharp, and uploads the deterministic tier key through the same provider's
Storage Adapter. R2 tier URLs remain `NULL` because these objects are private;
the authorized download endpoint serves them. Supabase retains its legacy
public tier URL behavior. A database-update failure leaves the deterministic
generated object in place for an idempotent retry instead of deleting a file
that may have been committed by a concurrent request.

### Risks and rollback

- Risk: returning a permanent public URL could expose an R2 original or
  private delivery tier.
- Risk: an incorrect provider/bucket fallback could cross tenant or bucket
  boundaries.
- Risk: concurrent lazy requests could overwrite or remove each other's
  derivative.
- Risk: updating only the single-photo route would leave ZIP downloads broken.
- Mitigation: existing share authorization remains unchanged, strict
  owner/album path checks run before object I/O, R2 uses one database-owned
  bucket, generated keys are deterministic and retry-safe, and both download
  routes share the same provider-aware resolver.
- Rollback: keep `R2_UPLOADS_ENABLED=false` and revert the provider-aware
  resolver/select fields. Existing Supabase paths and objects are unchanged;
  generated R2 objects can remain for later retry or Phase 11 orphan cleanup.

### Validation

- R2 original secure-proxy resolution test: passed
- R2 HD lazy-generation/upload/database-path test: passed
- Supabase original-bucket fallback plan test: passed
- Full Storage Adapter/schema/worker/download suite: passed
- `.env.example` coverage: passed (53 referenced variables documented)
- TypeScript: passed
- Phase 7 ESLint: passed with no warnings
- Full application ESLint: passed with 6 pre-existing `<img>` warnings
- Production build: passed
- API contract suite: 10 passed across desktop and mobile projects
- `git diff --check`: passed

No remote migration, live R2 upload/download, commit, deployment, or
rollout-gate change was performed in this phase.

## Phase 8

### Files

- `supabase/migrations/202609210004_storage_deletion_jobs.sql`
- `supabase/schema.sql`
- `src/lib/storage/deletion-jobs.ts`
- `src/app/api/photos/delete/route.ts`
- `src/app/api/albums/delete/route.ts`
- `scripts/retry-storage-deletions.ts`
- `scripts/auto-maintenance.ts`
- `scripts/test-storage-deletion.ts`
- `scripts/test-storage-schema.mjs`
- `package.json`

### Previous behavior

Photo deletion removed the database row first and then attempted to remove all
paths from the Supabase `albums` bucket. A storage failure therefore left an
orphan without durable retry metadata, and a legacy original already moved to
the private `originals` bucket was not removed. Album deletion did the reverse:
it removed listed Supabase objects before completing database cleanup, only
looked in `albums`, and could permanently remove files even when a later
database delete failed. Neither route understood R2 or mixed-provider albums.

### New behavior

Deletion uses a provider-neutral durable queue. Each route first validates
every object key against the authenticated owner and album, then stages exact
provider/bucket/key references. Staged jobs cannot be claimed. Only after the
application record is deleted are those jobs changed to `pending` and claimed
with `FOR UPDATE SKIP LOCKED` for immediate adapter-based deletion.

Supabase originals are scheduled against both `originals` and `albums` during
the compatibility period, while R2 uses only the bucket stored on the photo
row. Album deletion combines provider-aware photo references with safe legacy
Supabase folder listings for covers, presets, and other historical objects.
R2 non-photo album assets remain part of Phase 10 because their database
references do not exist yet.

Batch results are reconciled per object. Successful objects are completed;
failed or omitted results are persisted with bounded exponential backoff. A
maintenance worker requeues interrupted processing work, activates a staged
operation only when the corresponding photo or album is already gone, and
discards old abandoned staging rows when the application record still exists.
Storage cleanup failure does not roll back a successful user-visible database
deletion.

### Risks and rollback

- Risk: deleting an object owned by another user through a forged database
  path.
- Risk: losing files if storage deletion happens before database authorization
  and cleanup complete.
- Risk: treating a partial batch response as full success.
- Risk: an interrupted request leaving work permanently staged.
- Mitigation: strict owner/album folder allowlists, stage-before/delete and
  activate-after semantics, per-object result reconciliation, durable retry
  state, stale-stage recovery, service-role-only queue access, and exact R2
  bucket selection.
- Rollback: stop the storage-deletion retry worker, revert both routes to the
  previous Supabase-only behavior, and leave the additive queue table in place
  for audit. Pending rows must be drained or reviewed before dropping the
  table; reverting code does not require deleting any object or photo row.

### Validation

- Storage deletion path/provider/bucket planning checks: passed
- Cross-owner and unknown-folder rejection checks: passed
- Partial/missing provider result reconciliation check: passed
- Deletion queue migration/canonical-schema safety checks: passed
- TypeScript: passed
- Phase 8 ESLint: passed with no warnings
- Full Storage Adapter/schema/worker/download/deletion suite: passed
- Production build: passed
- API contract suite: 10 passed across desktop and mobile projects
- `.env.example` coverage: passed (53 referenced variables documented)
- `git diff --check`: passed

No remote migration, live object deletion, R2 request, commit, deployment, or
rollout-gate change was performed in this phase.

## Phase 9

### Files

- `supabase/migrations/202609210005_r2_camera_live_import.sql`
- `supabase/schema.sql`
- `src/lib/storage/camera-upload.ts`
- `src/app/api/photos/finalize-upload/route.ts`
- `workers/camera-live-import-worker.ts`
- `scripts/test-camera-storage.ts`
- `scripts/test-storage-schema.mjs`
- `package.json`

### Previous behavior

The camera worker uploaded every imported JPEG directly to the Supabase
`albums` bucket, then called the existing worker-secret finalizer with a
Supabase path. Upload retries generated a new object name, stale `uploading`
or `finalizing` rows were not resumed, and an uncertain finalizer response
could cause the worker to delete an object that the database had already
accepted. Camera imports had no persisted provider, bucket, or R2 reservation
binding.

### New behavior

Camera imports now use the same server-only Storage Adapter as the rest of the
photo pipeline. With the rollout gate disabled, new camera imports retain the
existing Supabase bucket and path behavior. With
`STORAGE_DEFAULT_PROVIDER=r2`, `R2_UPLOADS_ENABLED=true`, and complete R2
configuration, a new import receives the deterministic private key
`{ownerId}/{albumId}/original/{cameraImportId}.jpg`.

A service-role-only reservation RPC validates the active camera session,
album/owner binding, object key, preset path, file type, size, content SHA-256,
and current storage quota before binding a `photo_upload_sessions` row to the
camera import. Browser reservation RPCs remain unchanged and authenticated via
`auth.uid()`. The finalizer accepts R2 camera requests only when both the
worker secret and the camera-import binding are valid; dedicated begin and
complete RPCs then verify the reservation and inserted photo before completing
the session.

Uploads are retry-safe: the worker HEAD-checks a deterministic object before
PUT, reuses an exact size/type match, rejects a conflicting object, and resumes
stale `uploading`, `finalizing`, and `uploaded` states. It keeps the local file
until both finalization and the camera state update succeed. Unknown network
outcomes leave the object in place for idempotent retry. Cleanup runs only when
the finalizer explicitly marks the object safe to remove, while known
duplicates are removed and their reservation is cancelled.

Existing imports stay `storage_provider='supabase'`. A fallback query keeps the
legacy Supabase worker functional during a staggered deployment while the
rollout gate remains off. A previously
started R2 import remains on R2 even if the rollout gate is later disabled, so
rollback does not strand in-flight work.

### Risks and rollback

- Risk: a worker retry creates duplicate objects or duplicate photo rows.
- Risk: a forged worker request finalizes another user's object.
- Risk: quota checks race across browser and camera uploads.
- Risk: a finalizer timeout deletes an object that was already committed.
- Risk: disabling R2 strands an in-flight R2 camera import.
- Mitigation: deterministic UUID keys, HEAD verification, a per-owner advisory
  quota lock, service-role-only RPC grants, camera/session/album/owner binding,
  idempotent completed sessions, and conservative cleanup rules.
- Rollback: set `R2_UPLOADS_ENABLED=false`. New camera imports immediately use
  the existing Supabase path. Do not remove the additive database columns or
  RPCs until any persisted R2 camera imports have reached `done`; those rows
  intentionally continue through R2 during rollback.

### Validation

- Camera provider/key planning and rollback continuity checks: passed
- Idempotent HEAD/reuse and size-conflict checks: passed
- Camera migration/canonical-schema security checks: passed
- TypeScript: passed
- Phase 9 ESLint: passed with no warnings
- Full Storage Adapter/schema/worker/download/deletion/camera suite: passed
- Full application ESLint: passed with 6 pre-existing `<img>` warnings
- Production build: passed
- API contract suite: 10 passed across desktop and mobile projects
- `.env.example` coverage: passed (53 referenced variables documented)
- `git diff --check`: passed

No remote migration, camera hardware operation, live R2 request, rollout-gate
change, commit, or deployment was performed in this phase.

## Phase 10

### Files

- `supabase/migrations/202609210006_r2_portfolio_guest_presets.sql`
- `supabase/schema.sql`
- `src/lib/storage/assets.ts`
- `src/lib/storage/config.ts`
- `src/lib/storage/paths.ts`
- `src/lib/storage/supabase.ts`
- `src/lib/storage/deletion-jobs.ts`
- `src/app/api/portfolio/assets/upload-url/route.ts`
- `src/app/api/portfolio/assets/finalize/route.ts`
- `src/app/api/portfolio/assets/delete/route.ts`
- `src/app/portfolio/page.tsx`
- `src/components/portfolio-editor.tsx`
- `src/lib/portfolio-types.ts`
- `src/app/api/share/moments/route.ts`
- `src/app/api/presets/upload/route.ts`
- `src/app/api/presets/list/route.ts`
- `src/app/api/presets/recent/route.ts`
- `src/components/upload-photo-form.tsx`
- `src/components/album-camera-status.tsx`
- `workers/photo-worker.ts`
- `src/app/api/photos/retry-processing/route.ts`
- `src/app/api/albums/cover/route.ts`
- `src/app/api/albums/delete/route.ts`
- `src/lib/get-user-storage-plan.ts`
- `next.config.ts`
- `scripts/test-phase10-storage.ts`
- `scripts/test-storage-deletion.ts`
- `scripts/test-storage-schema.mjs`
- `e2e/api-contracts.spec.ts`
- `package.json`

### Previous behavior

The Portfolio editor uploaded resized JPEGs directly from the browser to the
public Supabase `albums` bucket and deleted old objects through the browser
client. Guest Moments sent images through the server for Sharp processing but
then uploaded only to the public Supabase `guest-moments` bucket. XMP presets
were uploaded to either `albums` or `presets` with no provider metadata, and
the Photo Worker tried both Supabase buckets directly. Selecting an album
cover changed `cover_photo_id` but left `cover_url` stale. Album deletion also
had no database-owned references for R2 Guest Moments or album-scoped presets.

### New behavior

`storage_assets` is an additive metadata table for Portfolio images, Guest
Moments, and presets. It stores the exact owner, optional album, provider,
bucket, object key, content type, byte size, public URL, and lifecycle status.
Existing Portfolio URL arrays, Guest Moment URL/path arrays, and photo
`preset_path` fields remain canonical to the feature UI, so old Supabase rows
continue to work. The existing `user_storage_usage` row now also counts these
non-photo objects; no second quota system was introduced.

Portfolio uploads now resize in the browser, request an authenticated
owner-scoped signed URL, upload directly to storage, and call a finalizer that
HEAD-verifies type and exact length before returning a stable public URL. The
database keeps asset IDs beside the existing Portfolio URLs. Removed assets
are deleted server-side only after the saved Portfolio no longer references
them. A failed or abandoned reservation remains discoverable for Phase 11
consistency cleanup instead of exposing storage credentials in the browser.

Public Portfolio and Guest Moment objects move to R2 only when the normal R2
rollout gate is enabled **and** `R2_PUBLIC_BASE_URL` is configured. Without a
stable public CDN/custom domain they deliberately remain on their existing
Supabase public buckets, even if private photo uploads have begun moving to
R2. Guest Moments retain the existing Sharp validation/resize step, then use
the Storage Adapter and the owner/album key
`{ownerId}/{albumId}/guest-moments/{uuid}.jpg`.

XMP presets are private. New presets use
`{ownerId}/presets/{uuid}.xmp` or
`{ownerId}/{albumId}/presets/{uuid}.xmp`, are uploaded through the adapter,
and are resolved by the Photo Worker from `storage_assets`. Presets created
before Phase 10 still fall back to the legacy Supabase `presets` or `albums`
bucket. Manual retry uses the same provider-aware HEAD check instead of a
Supabase folder listing.

Album covers now update both `cover_photo_id` and the selected photo's public
preview URL. Album deletion stages provider-aware non-photo assets in the
existing durable deletion queue before the database cascade, and includes the
old `{albumId}/{date}/{file}` Guest Moment path format for compatibility.
`next.config.ts` also permits the configured R2 public hostname for any future
optimized-image usage.

### Risks and rollback

- Risk: a public R2 object is uploaded without a stable CDN URL.
- Risk: a forged key crosses owner or album boundaries.
- Risk: an interrupted browser upload reserves quota or leaves an orphan.
- Risk: a preset path resolves against the wrong provider during mixed mode.
- Risk: album deletion removes database metadata before object cleanup is
  durably staged.
- Mitigation: public assets require the CDN-aware gate, all new keys are
  server-generated UUID paths, finalization re-reads owner-owned metadata and
  HEAD-verifies the object, upload reservations are quota-counted, XMP lookup
  is owner-scoped with a strict legacy fallback, and album assets are staged
  in the Phase 8 deletion queue before the album row is removed.
- Rollback: keep `R2_UPLOADS_ENABLED=false`. New Portfolio images, Guest
  Moments, and presets then continue through the same endpoints but target the
  existing Supabase buckets. Do not drop `storage_assets` while it contains
  active rows; its metadata is also what lets Phase 11 reconcile incomplete
  uploads and mixed-provider cleanup.

### Validation

- Phase 10 provider-gate, key-ownership, and source-wiring checks: passed
- Storage schema/additive migration checks: passed
- Full Storage Adapter/schema/worker/download/deletion/camera/asset suite:
  passed
- TypeScript: passed
- Phase 10 ESLint: passed with no warnings
- Full application ESLint: passed with 6 pre-existing `<img>` warnings
- Production build: passed
- API contract suite: 10 passed across desktop and mobile projects
- `git diff --check`: passed

No remote migration, live R2 request, rollout-gate change, commit, or
deployment was performed in this phase.

## Phase 11

### Files

- `supabase/migrations/202609210007_r2_storage_consistency.sql`
- `supabase/schema.sql`
- `src/lib/storage/types.ts`
- `src/lib/storage/r2.ts`
- `src/lib/storage/supabase.ts`
- `src/lib/storage/consistency.ts`
- `workers/storage-consistency-worker.ts`
- `src/app/api/storage/cleanup-orphan/route.ts`
- `src/app/api/admin/cleanup-orphan-files/route.ts`
- `scripts/cleanup-orphan-files.ts`
- `scripts/storage-cleanup-cron.ts`
- `scripts/test-storage-consistency.ts`
- `scripts/test-storage-schema.mjs`
- `.env.example`
- `package.json`

### Previous behavior

The consistency worker and both orphan-cleanup entry points were tied directly
to the public Supabase `albums` bucket. File existence was inferred by listing
one folder and searching for a filename. Orphan detection compared only plain
photo paths, so it did not distinguish provider or bucket and did not protect
Portfolio assets, Guest Moments, presets, signed-upload reservations, camera
imports, or objects already staged in the durable deletion queue. One legacy
admin endpoint also deleted immediately without a dry-run default.

### New behavior

The Storage Adapter now exposes an administrative paginated object inventory
in addition to exact HEAD checks. R2 uses S3 `ListObjectsV2`; Supabase keeps
its recursive folder traversal inside the adapter. Application and worker code
no longer calls either provider SDK directly for consistency or deletion.

`src/lib/storage/consistency.ts` builds identities from
`provider + bucket + object key`. It protects references from photos,
`storage_assets`, active browser/camera upload sessions, pending deletion jobs,
album covers and presets, legacy Guest Moments, legacy Portfolio URLs, and
profile/camera metadata. Tracked photos and non-photo assets are checked by
HEAD against their recorded provider. Legacy Supabase originals retain the
safe `originals` then `albums` fallback; R2 never falls back across buckets.

The worker scans bounded, rotating database batches, records provider-aware
missing/size-mismatch issues, resolves recovered objects, queues derivative
repair only when the original still exists, cleans expired upload reservations,
and processes/recoveries the durable Phase 8 deletion queue. Reservation
cleanup is dry-run while `STORAGE_CLEANUP_DRY_RUN=true`.

Orphan cleanup now defaults to dry-run, requires a minimum object age, limits
both inventory and deletion counts, and excludes sensitive cover/avatar/preset
paths from generic deletion. R2 deletion additionally requires the explicit
`STORAGE_CLEANUP_ALLOW_R2_DELETE=true` production gate. The old admin route is
kept as a backward-compatible alias to the guarded canonical handler.
Expired R2 upload reservations use the same additional gate and remain
discoverable for a later retry while it is disabled.

### Risks and rollback

- Risk: an incomplete reference inventory marks an active object as orphan.
- Risk: a newly uploaded object is observed before finalization commits.
- Risk: a large bucket requires more than one bounded inventory run.
- Risk: enabling destructive R2 cleanup too early removes migrated objects.
- Mitigation: all active reservations and deletion jobs are protected,
  objects without a reliable `lastModified` value are never auto-deleted,
  minimum age is 24 hours, deletion is limited to 100 objects per API run,
  and R2 needs a separate explicit delete gate in addition to `dryRun=false`.
- Rollback: stop the storage-consistency worker and keep both cleanup dry-run
  flags enabled. Existing read/upload behavior from Phases 1-10 is independent
  of the new inventory and issue table. Do not remove provider metadata.

### Validation

- Provider-aware candidate planning, dry-run, delete, and R2 safety-gate
  checks: passed
- Phase 11 migration/schema security checks: passed
- Full Storage Adapter/schema/worker/download/deletion/camera/asset/consistency
  suite: passed
- TypeScript: passed
- Phase 11 ESLint: passed with no warnings
- Full application ESLint: passed with 6 pre-existing `<img>` warnings
- Production build: passed
- API contract suite: 10 passed across desktop and mobile projects
- `.env.example` coverage: passed (70 referenced variables documented)
- `git diff --check`: passed

No remote migration, live R2 request, object deletion, rollout-gate change,
commit, or deployment was performed in this phase.

## Phase 12

### Files

- `src/lib/storage/config.ts`
- `src/lib/storage/delivery.ts`
- `src/lib/storage/album-covers.ts`
- `src/lib/storage/index.ts`
- `src/lib/share-data.ts`
- `src/app/albums/page.tsx`
- `src/app/albums/[id]/page.tsx`
- `src/app/albums/[id]/reorder/page.tsx`
- `src/app/albums/[id]/people/page.tsx`
- `src/app/albums/[id]/people/[personId]/page.tsx`
- `src/app/albums/[id]/analytics/page.tsx`
- `src/app/notifications/page.tsx`
- `src/app/api/albums/[id]/people/route.ts`
- `src/app/api/albums/cover/route.ts`
- `src/app/api/faces/search/route.ts`
- `src/app/api/share/faces/route.ts`
- `src/app/api/photos/upload-url/route.ts`
- `src/app/api/photos/finalize-upload/route.ts`
- `src/app/api/photos/upload/route.ts`
- `src/app/api/admin/users/[id]/route.ts`
- `src/app/api/presets/list/route.ts`
- `workers/photo-worker.ts`
- `scripts/test-dual-provider-reads.ts`
- `package.json`

### Previous behavior

Most galleries rendered URL columns already stored on `photos`. That worked
for new Photo Worker output, but several server reads did not also select
`storage_provider`, `storage_bucket`, `preview_path`, and `thumbnail_path`.
After a row switched to R2, an old Supabase URL could therefore remain visible
or a copied derivative with a valid R2 key could disappear from a query that
filtered on a non-null legacy URL. Face Search, People, Notifications,
Analytics, reorder, duplicate-upload responses, Admin, and public sharing did
not share one provider-resolution rule.

Album covers had an additional compatibility issue: `albums.cover_url` is a
denormalized stored URL. Moving the selected cover photo did not automatically
change that value. The Camera status preview and Photo Worker public URL logic
also contained provider-specific delivery behavior outside the central
storage layer. Legacy preset listing called Supabase Storage directly.

### New behavior

`resolvePhotoDelivery` is now the central public-read policy for photo rows.
It uses provider metadata plus the existing object paths to reconstruct only
public preview and thumbnail delivery URLs. For R2, the current
`R2_PUBLIC_BASE_URL` wins over a stale stored Supabase URL. For legacy
Supabase rows, the stored URL remains first choice and a missing derivative
can be rebuilt from the known public bucket. Invalid keys are rejected.

Originals, SD/HD/UHD derivatives, presets, and generated private downloads
are never synthesized as public R2 URLs. They continue through the signed or
authorized download flows implemented in Phase 7. `R2_PUBLIC_BASE_URL` can be
resolved independently of write credentials, so a read-only web process does
not need an R2 secret merely to render copied previews.

Public Share, Albums, People/Face Search, Analytics, Notifications, reorder,
cover selection, duplicate-upload responses, and Admin now select provider
metadata and apply the same resolver. Public gallery queries no longer hide
otherwise valid R2 rows merely because their legacy URL columns are null.

`resolveAlbumCoverDeliveries` rehydrates each denormalized album cover through
its `cover_photo_id`, with the stored `cover_url` retained as a migration
fallback. This covers the Albums list, Album Detail, Analytics, and public
share page. The Photo Worker and legacy preset inventory now use central
storage helpers rather than direct provider SDK calls.

No database migration is added in this phase. It consumes the additive Phase
3 provider fields, so Phase 3 must be applied before deploying this code. The
R2 upload gate remains disabled.

### Risks and rollback

- Risk: a migrated row has R2 paths but the web runtime has no public delivery
  base, causing a blank preview after its Supabase source is later removed.
- Risk: a stale denormalized album cover keeps pointing to Supabase.
- Risk: a resolver accidentally publishes an original or generated download.
- Risk: mixed deployments query provider columns before the Phase 3 migration.
- Mitigation: R2 resolution safely falls back to the retained Supabase URL
  during the copy-only period, cover URLs are rehydrated by `cover_photo_id`,
  the public-prefix allowlist excludes private object classes, and deployment
  ordering requires the additive migrations before application rollout.
- Rollback: keep `R2_UPLOADS_ENABLED=false` and deploy the prior application
  build. Existing Supabase objects and stored URLs remain untouched. Do not
  begin Phase 15 cleanup until every production read surface has passed the
  Phase 14 canary and `R2_PUBLIC_BASE_URL` is present in all web/worker
  runtimes.

### Validation

- Phase 12 dual-provider URL, private-object, unsafe-key, and source-wiring
  checks: passed
- Full Storage Adapter/schema/worker/download/deletion/camera/asset/
  consistency/read suite: passed
- TypeScript: passed
- Phase 12 ESLint: passed with no warnings
- Full application ESLint: passed with 6 pre-existing `<img>` warnings
- Production build: passed
- API contract suite: 10 passed across desktop and mobile projects
- `.env.example` coverage: passed (70 referenced variables documented)
- `git diff --check`: passed

No remote migration, live R2 request, object copy/deletion, rollout-gate
change, commit, or deployment was performed in this phase.

## Phase 13

### Files

- `supabase/migrations/202609210008_supabase_to_r2_photo_migration.sql`
- `supabase/schema.sql`
- `src/lib/storage/migration.ts`
- `src/lib/storage/index.ts`
- `scripts/migrate-supabase-to-r2.ts`
- `scripts/test-photo-storage-migration.ts`
- `scripts/test-storage-schema.mjs`
- `.env.example`
- `package.json`

### Previous behavior

The application could create new R2 photos and read both providers, but there
was no bounded tool for moving an existing Supabase photo. Manually copying an
object and changing `storage_provider` could switch the database before every
derivative existed, race a Photo Worker, overwrite a conflicting R2 key, or
leave an interrupted row with no retry history.

### New behavior

The additive migration records `migration_attempts`, `migration_error`,
`migration_started_at`, and `migration_completed_at` on the existing `photos`
table. A service-role-only claim RPC selects at most 50 rows with
`FOR UPDATE SKIP LOCKED`, increments the attempt count, and moves them to
`copying`. It excludes photos with active processing states and photos with a
pending/processing Photo Worker job. Failed rows and stale copying/verifying
rows are only reclaimed through explicit CLI flags.

`src/lib/storage/migration.ts` builds a unique object plan from the existing
original, preview, thumbnail, SD, HD, and UHD paths. Every key must remain
inside `{ownerId}/{albumId}/{allowed-tier}/...`. Legacy originals are searched
in `originals` and then `albums`; derivatives stay in `albums`. The target uses
the same key in the configured R2 bucket.

Each object goes through this sequence:

1. HEAD the Supabase candidates and find the real source bucket.
2. Compare source `Content-Length` with the database size when one is known.
3. HEAD R2. Reuse an exact-size object or reject a size conflict.
4. Download the source and verify the received byte length.
5. Upload with `If-None-Match: *` through the Storage Adapter.
6. Move the row to `verifying` and HEAD both providers again.
7. Switch the row to R2 only after every referenced object matches.

Completion writes the configured R2 bucket and stable preview/thumbnail URLs,
marks the row `completed`, refreshes a matching denormalized album cover, and
clears direct Original/SD/HD/UHD URL fields so private downloads continue
through the authorized Phase 7 flow. If any step fails, the row remains on
Supabase with `migration_status='failed'`; already-copied R2 objects are reused
by the next explicit retry.

The CLI is read-only by default:

```text
npm run storage:migrate:r2 -- --limit=5
```

Apply mode requires both `--apply` and the separate server-side
`STORAGE_MIGRATION_APPLY_ENABLED=true` gate. `--retry-failed` retries failed
rows, `--recover-stale` reclaims interrupted rows after the configured stale
window, and `--photo-id=<uuid>` bounds a canary to one photo. Migration is
sequential and rejects objects over 512 MiB by default; the limit can be raised
explicitly with `--max-object-bytes` after reviewing worker memory.

The tool contains no source-delete operation. Supabase cleanup remains Phase
15 and must not be combined with copy or verification.

This phase migrates objects referenced by `photos` rows only. Legacy
Portfolio, Guest Moment, and Preset objects continue to use the Phase 10
dual-provider compatibility paths and are excluded from Phase 15 cleanup
until they have their own verified migration inventory.

### Risks and rollback

- Risk: the source changes while it is being copied.
- Risk: an interrupted run leaves objects in both providers.
- Risk: an existing R2 key belongs to different bytes.
- Risk: large originals exhaust migration-runner memory because the current
  adapter download contract returns a Buffer.
- Risk: a migrated preview has no stable public delivery base.
- Mitigation: active workers are excluded, source and target sizes are checked
  twice, existing same-size targets are reused while size conflicts fail,
  retries are idempotent, processing is sequential with a default size cap,
  and completion requires `R2_PUBLIC_BASE_URL` whenever public derivatives
  exist.
- Rollback before apply: leave the apply gate false; dry-run never claims or
  changes a row. Rollback after an individual failure is automatic because the
  provider remains Supabase. A completed canary can be returned to Supabase by
  restoring its provider metadata only after re-HEADing the retained source;
  no object restoration is needed because this phase never deletes it.

### Validation

- Copy, second-pass verification, original-bucket fallback, path ownership,
  rerun/reuse, size-conflict, and source-size checks: passed
- Phase 13 additive schema, atomic claim, active-job exclusion, and
  service-role grant checks: passed
- Full Storage Adapter/schema/worker/download/deletion/camera/asset/
  consistency/read/migration suite: passed
- TypeScript: passed
- Phase 13 ESLint: passed with no warnings
- Full application ESLint: passed with 6 pre-existing `<img>` warnings
- Production build: passed
- API contract suite: 10 passed across desktop and mobile projects
- `.env.example` coverage: passed (71 referenced variables documented)
- `git diff --check`: passed

No remote migration, live Supabase/R2 copy, database claim, source deletion,
rollout-gate change, commit, or deployment was performed in this phase.

## Phase 14

### Files

- `src/lib/storage/production-validation.ts`
- `src/lib/storage/config.ts`
- `src/lib/storage/assets.ts`
- `src/lib/storage/index.ts`
- `scripts/validate-r2-production.ts`
- `scripts/test-r2-production-validation.ts`
- `scripts/test-phase10-storage.ts`
- `src/app/api/photos/upload-url/route.ts`
- `src/app/albums/[id]/page.tsx`
- `workers/camera-live-import-worker.ts`
- `src/app/api/portfolio/assets/upload-url/route.ts`
- `src/app/api/presets/upload/route.ts`
- `src/app/api/share/moments/route.ts`
- `.env.example`
- `package.json`

### Previous behavior

The Phase 13 CLI could migrate one selected photo safely, but there was no
single production-readiness report proving that the deployed schema, claim
RPC, R2 bucket permissions, retained Supabase source, R2 object sizes, public
CDN, private delivery boundary, quota record, and worker state were all
healthy. Enabling the global R2 upload flags also enabled R2 writes for every
owner at once.

### New behavior

`npm run storage:validate:r2` is a read-only Production validator. It checks
the server environment without printing credentials, queries the additive
Phase 13 photo fields, probes the claim RPC with an intentionally invalid
zero limit that exits before any row can be claimed, lists one R2 object to
verify bucket access, and reports provider/migration inventory. The report is
newline-delimited JSON with `pass`, `warning`, and `fail` checks plus a final
Go/No-Go summary. Any failed check exits non-zero; `--strict-warnings` also
makes warnings block rollout.

With `--photo-id=<uuid>`, the validator additionally confirms:

- the row is `storage_provider='r2'`, points to the configured bucket, and has
  `migration_status='completed'`;
- no Photo Worker job is active for the canary;
- every Phase 13 migrated object still exists in Supabase and exists in R2
  with the same `Content-Length`; a new R2-native upload validates R2 against
  its database sizes without incorrectly requiring a Supabase copy;
- stored preview/thumbnail/public URLs match the current R2 CDN/gateway;
- Original, SD, HD, and UHD direct URL fields remain empty;
- the private Original can create a 60-second signed HTTPS download URL;
- the public derivative returns a successful HTTP HEAD response while the
  same public gateway rejects the private Original path; and
- the existing `user_storage_usage` row remains valid.

`R2_UPLOAD_CANARY_OWNER_IDS` adds a server-side owner allowlist to all new R2
write entry points: browser photo uploads, Camera Live Import, Portfolio,
Guest Moments, and Presets. When the global R2 gates are enabled and this list
contains owner UUIDs, only those owners write to R2; everyone else remains on
the legacy Supabase flow. An empty allowlist retains the intended full-rollout
behavior, but the strict Phase 14 validator warns and blocks that state during
a bounded canary.

The validator contains no insert, update, upload, copy, or delete operation.
It never invokes the Phase 13 claim RPC with a valid limit.

### Production Go/No-Go runbook

1. Apply additive migrations `202609210001` through `202609210008` before
   deploying the application and workers. Keep all write and cleanup gates
   disabled.
2. Configure R2 credentials, a private bucket, CORS for the production web
   origin, and an HTTPS `R2_PUBLIC_BASE_URL` gateway that exposes only public
   prefixes. The raw R2 S3 endpoint must not be used as the public base.
3. Run the read-only preflight:

   ```text
   npm run storage:validate:r2 -- --expect-rollout=disabled
   ```

4. Choose one completed, idle photo with Original, Preview, and Thumbnail.
   Dry-run its Phase 13 plan:

   ```text
   npm run storage:migrate:r2 -- --photo-id=<photo_uuid> --limit=1
   ```

5. Enable `STORAGE_MIGRATION_APPLY_ENABLED=true` only in the isolated
   migration runner, run the same command with `--apply`, and disable the gate
   immediately afterward. Never enable a cleanup gate during this step.
6. Validate the copied existing-photo canary while global R2 uploads remain
   disabled:

   ```text
   npm run storage:validate:r2 -- --photo-id=<photo_uuid> --expect-rollout=disabled --strict-warnings
   ```

7. For a new-upload canary, set `STORAGE_DEFAULT_PROVIDER=r2`,
   `R2_UPLOADS_ENABLED=true`, and
   `R2_UPLOAD_CANARY_OWNER_IDS=<owner_uuid>`. Deploy the web application and
   all provider-aware workers together. Confirm a non-allowlisted owner still
   receives the Supabase upload flow.
8. From the allowlisted account, upload one test photo and wait for Photo and
   Face jobs to finish. Run the validator against the new photo:

   ```text
   npm run storage:validate:r2 -- --photo-id=<new_photo_uuid> --expect-rollout=enabled --strict-warnings
   ```

9. Smoke-test Album, Public Share, QR Gallery, Realtime refresh, Face Search,
   SD/HD/UHD/Original downloads, Portfolio, Guest Moments, Camera Live Import,
   Notifications, Analytics, and storage quota for the canary owner. Observe
   worker failure/stale-job metrics and R2/Supabase error rates for at least
   24 hours before expanding the allowlist.
10. Go requires zero failed validator checks, zero warnings in strict mode,
    no private-path exposure, no quota drift, no stuck storage migration, and
    no increase in worker/upload/download failures. Expand owner UUIDs in
    small batches. Remove the allowlist only after full-rollout approval.

### Risks and rollback

- Risk: both global gates are enabled with an empty owner allowlist, changing
  every new upload at once.
- Risk: the public R2 gateway serves an Original or preset path.
- Risk: web and workers are deployed with different R2/canary settings.
- Risk: an existing-photo canary succeeds while the browser CORS upload path
  is still broken.
- Mitigation: strict owner allowlisting, separate existing/new-upload
  canaries, live public/private boundary probes, one deployment unit for the
  web and workers, and a 24-hour observation window.
- Rollback: set `R2_UPLOADS_ENABLED=false` (or
  `STORAGE_DEFAULT_PROVIDER=supabase`) and redeploy the web and workers
  together. New traffic returns to Supabase while completed R2 rows remain
  readable through Phase 12. Retain all copied Supabase source objects and do
  not start Phase 15 cleanup.

### Validation

- Production environment, owner allowlist, cleanup gate, canary object parity,
  source retention, size mismatch, private URL, signed download, and static
  read-only CLI checks: passed
- Phase 10 public asset compatibility checks: passed
- Camera upload planning checks: passed
- Full Storage Adapter/schema/worker/download/deletion/camera/asset/
  consistency/read/migration/production-validation suite: passed
- TypeScript: passed
- Phase 14 ESLint: passed with no warnings
- Full application ESLint: passed with 6 pre-existing `<img>` warnings
- Production build: passed
- API contract suite: 10 passed across desktop and mobile projects
- `.env.example` coverage: passed (72 referenced variables documented)
- `git diff --check`: passed

No Production environment probe, database migration, live canary copy/upload,
rollout-gate change, source deletion, commit, or deployment was performed in
this phase.

## Phase 15

### Files

- `src/lib/storage/source-cleanup.ts`
- `src/lib/storage/consistency.ts`
- `src/lib/storage/index.ts`
- `scripts/cleanup-migrated-supabase-sources.ts`
- `scripts/test-supabase-source-cleanup.ts`
- `scripts/test-storage-consistency.ts`
- `scripts/test-storage-schema.mjs`
- `supabase/migrations/202609210009_delayed_supabase_source_cleanup.sql`
- `supabase/schema.sql`
- `.env.example`
- `package.json`

### Previous behavior

Phase 13 deliberately retained every Supabase source after a verified R2 copy,
but there was no auditable retention/cleanup state or dedicated cleanup tool.
Because a completed photo's active provider is R2, the generic Supabase orphan
scanner could also mistake the retained rollback copy for an orphan.

### New behavior

Six additive fields record source retention and cleanup without changing the
existing Photo model or provider metadata:

- `source_cleanup_status`: `not_applicable`, `retained`, `deleting`,
  `completed`, or `failed`;
- `source_cleanup_after`, defaulted to 30 days after a completed Phase 13
  migration;
- `source_cleanup_attempts`, error, start, and completion audit fields.

Only photos copied by Phase 13 are eligible: they must be R2-backed,
`migration_status='completed'`, and have `migration_attempts > 0`. New
R2-native photos stay `not_applicable`. The service-role-only claim RPC uses
`FOR UPDATE SKIP LOCKED`, requires the retention date to have passed, excludes
active Photo Worker jobs and processing states, and supports explicit failed
or stale retry modes. The minimum age accepted by the RPC is seven days, while
the operational/default retention is 30 days.

The cleanup command is read-only by default:

```text
npm run storage:cleanup:supabase-sources -- --limit=5
```

Dry-run performs R2 and Supabase HEAD checks but does not claim rows or mutate
the database. Apply mode requires all three independent signals:

1. command flag `--apply`;
2. `STORAGE_SOURCE_CLEANUP_APPLY_ENABLED=true` in the isolated cleanup runner;
3. `STORAGE_SOURCE_CLEANUP_CONFIRM=DELETE_VERIFIED_SUPABASE_SOURCES`.

For every referenced Original, Preview, Thumbnail, SD, HD, and UHD key, apply
mode revalidates ownership, album scope, configured R2 bucket, positive R2
Content-Length, database-known size, and Supabase/R2 size parity. It then
deletes only the matching Supabase source candidates and HEAD-checks that they
are gone. It never calls an R2 delete operation. A partial failure is recorded
as `failed`; a later `--retry-failed` run is idempotent and deletes only sources
that still exist. Interrupted claims can be reclaimed only with the explicit
`--recover-stale` option.

Generic orphan cleanup now protects retained Supabase source candidates while
cleanup is `retained`, `deleting`, or `failed`. It also protects them during a
mixed deployment where the Phase 15 fields are not available yet. Protection
is removed only after the cleanup status is `completed`.

This phase is intentionally limited to objects referenced by `photos` rows
that Phase 13 migrated. It does not delete legacy Portfolio, Guest Moment,
Preset, cover, avatar, camera staging, or generated-download objects. Those
object classes need their own verified migration inventory before any future
source cleanup.

### Production cleanup runbook

1. Deploy migrations `202609210001` through `202609210009`, then deploy the
   provider-aware web application and workers. Keep both Phase 15 environment
   gates disabled.
2. Complete the Phase 14 strict validator and all feature smoke tests. Observe
   the completed R2 rollout for at least 24 hours; the scheduled source cleanup
   remains unavailable until the 30-day retention timestamp is due.
3. Confirm backups, Supabase Storage inventory retention, R2 lifecycle rules,
   worker health, quota totals, and zero unresolved storage consistency issues.
4. Run dry-run for one known Phase 13 canary:

   ```text
   npm run storage:cleanup:supabase-sources -- --photo-id=<photo_uuid> --limit=1
   ```

5. Review every reported key, source bucket, R2 size, source size, and the
   `r2Deletion:false` marker. A warning or mismatch is No-Go.
6. In an isolated one-off runner only, set the two Phase 15 environment values,
   repeat the same bounded command with `--apply`, then immediately clear both
   values. Do not enable generic orphan deletion in the same run.
7. Re-run Phase 14 validation, Album/Public Share/Face Search/download smoke
   tests, and storage consistency. Observe the canary before expanding in
   small batches.
8. Use `--retry-failed` only after investigating a recorded failure. Use
   `--recover-stale` only after confirming the prior cleanup runner is no longer
   active. Never lower `--minimum-age-days` merely to accelerate rollout.

### Risks and rollback

- Risk: a retained source is deleted before the R2 copy is durable.
- Risk: a concurrent worker or cleanup runner changes the same photo.
- Risk: legacy originals exist in either the `originals` or `albums` bucket.
- Risk: partial deletion leaves only some source objects.
- Mitigation: a 30-day retention schedule, provider/migration/attempt gates,
  active-job exclusion, atomic claims, full per-object HEAD and size parity,
  both legacy Original bucket candidates, post-delete HEAD, and explicit retry.
- Rollback before apply: leave either environment gate unset; dry-run is
  read-only. Rollback after a partial failure: retain the R2 provider and retry
  only after investigation. Once all Supabase copies for a photo have been
  deleted, rollback requires restoring them from an independent backup or R2;
  changing only `storage_provider` back to Supabase is not sufficient.

### Validation

- Source/R2 parity, legacy Original fallback, missing/mismatched R2 guard,
  partial failure, idempotent retry, R2-native exclusion, and unsafe-path
  checks: passed
- Generic orphan-cleanup retention protection and completion release: passed
- Additive schema, 30-day schedule, atomic claim, active-job exclusion, and
  service-role grant checks: passed
- Phase 15 environment coverage and TypeScript: passed
- Full Storage Adapter/schema/worker/download/deletion/camera/asset/
  consistency/read/migration/validation/cleanup suite: passed
- Phase 15 ESLint: passed with no warnings
- Full application ESLint: passed with 6 pre-existing `<img>` warnings
- Production build: passed
- API contract suite: 10 passed across desktop and mobile projects
- `.env.example` coverage: passed (74 referenced variables documented)
- `git diff --check`: passed

### Production cleanup start — 2026-09-27

Phase 15 was started with a non-destructive Production preflight. The cleanup
and migration apply gates remained disabled throughout the run.

- 12 Phase 13 photos are eligible after retention and all remain `retained`;
- no migration is `copying`, `verifying`, or `failed`;
- no Photo Worker job is pending or processing;
- the first retained source becomes eligible at
  `2026-10-22T04:25:34.663Z` (11:25 Asia/Bangkok);
- the bounded cleanup dry-run selected zero rows because none has reached its
  30-day retention timestamp;
- the read-only consistency audit checked 238 objects: 238 healthy, zero
  missing, zero mismatched, and zero open issues;
- the selected Phase 13 canary passed database state, processing state,
  Supabase/R2 size parity, public delivery, private original isolation,
  signed download, active-job, and quota checks;
- Node.js 20 maintenance CLIs now provide the existing `ws` transport to the
  Supabase client, and the validator correctly accepts a selected owner during
  an intentional full R2 rollout.

This is a deliberate No-Go for source deletion until retention expires. No
database claim, Supabase object deletion, R2 object deletion, or rollout-gate
change was performed. On or after 2026-10-22, repeat the one-photo dry-run and
review every reported source/R2 size before temporarily enabling the isolated
apply gates.
