# Ciiya mobile

The Ciiya photographer app for iOS and Android, built with Expo 57 / React Native.
It lives beside the web app but has its own dependencies, lint and typecheck;
the web app's `tsconfig.json` and ESLint config exclude this folder.

## Run

```bash
cp .env.example .env.local   # fill in the two public Supabase values, never server secrets
npm ci
npm run ios                  # opens the iOS Simulator (Expo Go)
npm run android              # Android device/emulator with Expo Go
```

## Check

```bash
npm test                     # offline mocked regressions; no production writes
npm run typecheck
npm run lint
npx expo-doctor
```

## Demo mode

`EXPO_PUBLIC_DEMO=1 npx expo start` runs the app on built-in sample data, with
no sign-in and no network writes. It only works in development builds.

## Photographer album workflow

- Search album names and descriptions locally, in Thai or English. Queries are
  not sent to a search service. Sort by newest, natural name order or photo count;
  cached albums and a retry action remain available if refresh fails.
- Creating an album opens that album immediately, ready to add photos. Once the
  server confirms its ID, a follow-up detail read cannot turn the acknowledged
  creation into a failed form submission. The album screen owns retryable reads.
- Inside an album, search loaded photos by filename in Thai or English and filter
  by all, ready or not ready. Queries stay on the phone; counts and no-match
  messages describe only loaded photos, not the whole album. Filtered browsing
  offers an explicit load-more button rather than automatically fetching every
  page. Not ready is not a diagnosis of a failed worker job. A filtered viewer
  keeps the selected photo IDs in their original order while their previews and
  readiness update, so processing completion cannot shift its current photo.
- Native taps are synchronously single-flight for create, metadata save, cover
  selection and upload preparation. Native album deletion and password/download
  edits are not exposed. Network failures still need deliberate reconciliation/retry;
  these UI fences are not server-side idempotency for a lost acknowledgement.
- The metadata form shows name/description counters and whether its loaded
  draft has been edited. Stack removal with unsaved text requires an explicit
  keep-editing/discard choice. While saving it stays open with inline guidance;
  an acknowledged save leaves normally. Discard affects only unsaved text, not
  an album/photo, and never cancels a request already sent. Drafts are memory-only:
  this does not protect against force-close, a crash or identity-driven unmount.
- Upload confirmation explains that the app must stay open for uploads to run.
- The album's share icon opens a delivery review: album details, last loaded
  password/download settings and the existing gallery link. Opening a gallery
  or native share sheet requires an explicit button press and a fresh owner
  read. Changed protection/download settings or a rotated token update the
  review first and require another intentional tap. Failed reads never fall
  back to sharing a cached token. Focus and immediate SDK account changes
  invalidate pending handoffs; native activities are synchronously single-flight.
  This screen never creates a share token, changes publication/access, includes
  a password in shared content, or claims the client received a link. It does
  not verify publication or anonymous access (those fields are not in the owner
  read model). Opening the existing public gallery can run its existing view
  analytics; the new owner review itself only reads.
- The upload queue also has direct share-link, copy-link, QR-preview and QR-export
  controls, including after clearing its local finished history. A fully settled
  batch gets a completion heading; stored uploads are still not proof of processed
  previews. These controls reuse the same owner/fresh-settings review, not a
  cached-token shortcut. QR generation is local and exports the same SVG format
  as the web app. On iPhone the export opens the native menu; choose Save to Files.
  Dismissing that menu does not prove a file was saved or delivered. Copying writes
  only the gallery URL and never reads or subscribes to the existing clipboard.

## How it talks to Ciiya

- Photographers sign in with Supabase Auth (email and password, or Google via
  S256 PKCE). Session and verifier are stored in the device keychain. Storage
  uses byte-bounded chunks and an inactive-slot/manifest commit, so interrupted
  writes do not mix old and new sessions. Older numbered chunks remain readable.
- Browser completion and cold-start callback use one code exchange; unrelated
  callback URLs, duplicate codes and implicit bearer-token redirects are rejected.
  Native `pkce-crypto.ts` supplies Expo randomness/digest for PKCE only, not a full
  WebCrypto implementation. Do not use `auth.getClaims()` with asymmetric JWTs
  on this partial adapter; use `auth.getUser()` for server-verified identity.
- Albums and photos are read from the web app's `/api/mobile/*` routes. Creation
  and uploads use the separately authorized shared write routes; metadata and
  cover edits use the separately authorized native PATCH routes released below.
  Every live request
  carries the signed-in user's access token as `Authorization: Bearer`, so the
  server applies the same ownership rules as on the web.
- `EXPO_PUBLIC_SITE_URL` picks the server (default `https://www.ciiya.app`).
  Point it at a local `npm run dev` to test against unreleased API changes.
- Only the public anon key ships in the app. Never add the service role key or
  a worker secret here.
- Owner photo pagination uses `(created_at, id)` cursors so simultaneous uploads
  do not skip photos. Processing updates are bounded to 120 IDs per request.
- Web API requests have a 30-second deadline covering token lookup, fetch and
  response body. Cached albums/photos stay visible with a retry action on errors.
- Supabase Auth/PostgREST requests also have a 30-second header/body deadline,
  so a black-holed network cannot leave SDK initialization and the splash pending
  forever. The SDK may retry a fast refresh failure within its own bounded window.
  Large photo transfers use their separate native file transport.
- The lightbox uses UI-thread pinch/pan on both platforms, bounded to 1–4×,
  with accessible zoom/reset and previous/next buttons. At 1× it allows horizontal photo paging;
  while zoomed it pans only within the image edges and resets on a new photo.

The tuple cursor and processing-update changes also modify the mobile read API.
The read-only server release was deployed on 2026-10-14 as recorded below;
mobile bundle export alone does not deploy server changes. Album mutations and
photo-upload bearer support are separate server-release gates, not included in
that initial read-only deployment. The separately authorized creation/R2-upload
and subsequent title/description/cover releases are recorded below. Password,
download, publication and album deletion mutations remain disabled in the app.

## Uploads

Photos picked from the phone's library are copied into the app's documents
folder and listed in a queue that is saved to disk (`src/lib/uploads/`). The
queue sends two at a time through the same reserve → upload → finalize routes
as the website, retries dropped connections on its own, and picks up where it
left off when the app is opened again. Uploads are foreground-driven: this is not
a guarantee of execution while iOS/Android suspends or force-closes the app.
A queue belongs to one account; signing out pauses and hides it. Signing into
the same account resumes it; a different account discards only its local queued
copies. Never remove an original supplied by the system photo picker.

- JPEG, PNG and WebP are sent as the system hands them over. HEIC (the iPhone camera's
  default) is converted to a full-resolution JPEG first, because the server
  accepts only those three formats; the converted copy carries no EXIF data.
- Each file can be up to 200 MB, and up to 100 photos can be picked at a time.
- In demo mode the upload itself is simulated, and every third photo drops its
  connection once so the automatic retry is visible.
- Native uploads are R2-only. `R2_UPLOADS_DISABLED` stops rather than falling
  back to Supabase or retrying indefinitely. Existing Supabase staged journals
  are held without auth/file/network work and are never resumed or removed.
- Intent is journaled before finalization. An ambiguous/lost acknowledgement
  never authorizes deleting any possibly accepted original or repair source.
  The native transport sends no remote DELETE/cancellation requests and remote
  discard is a no-op, even when a server response says `cleanupSafe`. Failed or
  abandoned reservations remain for existing expiry/audit and explicit review;
  this feature does not enable cleanup gates.
- Reservation/finalization JSON calls have a bounded network deadline,
  separate from the large native file transfer. A transient token-refresh failure
  is retryable network trouble, not evidence that the owner signed out.
- The per-album upload review shows waiting, sending, registering, stored,
  already-present and failed counts for this phone's queue, not worker-job totals
  or a server-wide history. Stored is not proof that previews are processed.
  Explicit retry buttons replace tappable failed rows. Removing an unfinished
  transfer now requires confirmation and a fresh check of its identity/state;
  completed, registering/uncertain and held legacy items cannot be removed from
  this screen. Old dialogs are fenced after account/album/focus lifetime changes.
  Removal affects only the existing local queue operation, never the photo
  library original or stored remote photo. Bulk UI retry skips held legacy
  Supabase journals. This does not change automatic upload retry policy or add
  background execution, remote cancellation, worker-job retry or cleanup gates.

## Google sign-in setup

Test Google OAuth in a locally installed debug/development build, not Expo Go.
Expo's authentication guide requires a development build for OAuth testing
because Expo Go cannot customize the app's URL scheme:
https://docs.expo.dev/guides/authentication/

Add the exact installed-app redirect to Supabase → Authentication → URL
Configuration: `ciiya://auth/callback`. Do not change the production website's
Site URL or add a wildcard covering every Expo project. An Expo Go redirect
allow-list entry alone is not proof that native Google login works.

For physical-device testing without paid Apple Developer membership, use Xcode
with the owner's Apple Account / Personal Team, connect and trust the iPhone,
and enable Developer Mode. Install the SDK-compatible `expo-dev-client` with
`npx expo install expo-dev-client`; a bare Debug build is not a development
client and may have no JavaScript URL when opened on a physical device. The
configured launcher lets the owner select the current LAN development server
without hardcoding its address in app config. Generate the iOS project with
Expo prebuild and use the generated workspace for Xcode automatic signing. Build with
`npx expo run:ios --device` (Node 22.13+). This is a local debug build, not an
EAS cloud build or a Store submission. Personal Team provisioning expires after
7 days and requires rebuilding/reinstalling. Never commit signing credentials.

Start and finish OAuth on the same device. PKCE verification does not work if
the code is transferred to another device. An old implicit-flow login attempt
must be cancelled and started again after updating this app.

## Build and release gates

`eas.json` defines local configuration only; it does not initialize a cloud
project, upload environment variables, create signing credentials or submit apps.
All profiles use Node 24.10.0 (the decoder adapter requires Node 22.13 or later).
The default server is `https://www.ciiya.app`; release demo mode is disabled.

After approving the Expo project, public environment values and signing setup:

```bash
npx eas-cli@latest build --platform android --profile preview   # APK for device testing
npx eas-cli@latest build --platform ios --profile preview-simulator
npx eas-cli@latest build --platform ios --profile production    # signed build for TestFlight, not submission
```

An Expo export verifies production JavaScript/Hermes bundles, **not an APK/IPA**.
Store signing/submission and physical-device acceptance are still separate gates.
Never ship the Supabase service-role key, Stripe secret or R2 credentials in any
`EXPO_PUBLIC_*` value.

Device acceptance before beta distribution:

- Fresh Google/password login, cancelled login, cold-start return, relaunch,
  token expiry and sign-out/same-account/different-account queue isolation.
- Create/edit/share an owned album, password-protected share, change cover,
  scroll past 60 photos and refresh while new photos are arriving.
- Photo permission denied/limited/full; JPEG/PNG/WebP/HEIC; batch upload;
  network loss, force-close during upload/finalize and retry without duplicates
  or deletion of accepted originals. Check worker results, not just an upload bar.
- Both platforms: safe areas, dark mode, accessibility, image swipe/zoom, keyboard
  and low-memory behavior. Simulator/demo tests do not satisfy this checklist.

The current photographer build includes albums, uploads, photo viewing with
loaded-filename search/readiness filters,
share-link review/copy/local QR export, account usage and enabled title/description/cover editing.
The account tab now shows used/remaining space and read-only quota warnings,
with owner/focus-scoped reads and explicit local-device sign-out confirmation.
The latter APIs have been deployed, but physical-device acceptance is pending.
It is not a feature-for-feature mobile copy
of the website: native camera/USB tethering, guest face search, portfolio editor,
push notifications and native billing/account deletion are not implemented here.
Store-policy/privacy/account-management review is required before public stores.

### Current owner-app scope — revised 2026-10-14

The owner subsequently narrowed the goal to **necessary workflows for the
signed-in account owner/photographer**, adapted to mobile. Full Web parity is no
longer the completion target. The existing guest/client experience, shared-link
gallery and guest/people-facing pages are accepted and outside this development
batch. Do not build a native client gallery, guest face search or Guest Moments
from the earlier inventory. Admin remains deferred.

Prioritize owner albums, uploading and photo management, delivery controls and
account usability. Keep the existing guest gallery available through its current
Web link. People/analytics, portfolio, Sync and billing are reference items to
evaluate only when necessary for the owner's workflow, not commitments to port
everything. The earlier six phases still organize work, not a completeness claim.

The local owner usability addition is Account → App language: device
default, Thai and English. It updates labels and album date/sort locale using
the current selection, remembers the choice on this device, and keeps an
explicit retry message if preference persistence fails. It uses the existing
installed localization/storage modules and a dedicated preference key; it does
not require a new native module or a Production API release.

Owner language verification: 458/458 mobile offline tests, TypeScript and lint
passed. The iOS Hermes bundle exported successfully and the existing local
development server remains running. Language changes and persistence on the
physical iPhone still need the owner's acceptance; automated storage tests cover
restart, delayed startup reads, rapid choices and explicit persistence retries.

### Owner photo processing — prepared 2026-10-14

The owner's album grid now understands waiting, working, failed, stopped,
preview-preparation and unknown states. It shows only bounded processing
percentages received from the backend, adds a local Failed filter, and counts
only known states among loaded photos. Missing legacy API fields stay unknown;
they are never treated as a failed job or a healthy worker. The existing loaded
range, filename search and frozen viewer IDs remain intact. Failed/cancelled
photos are excluded from automatic polling; the owner can deliberately refresh
the album after changing a job elsewhere. This batch does not retry worker jobs.

Failed polling keeps the photos and their cursor, exposes a stale-read message
and offers an owner/focus-guarded refresh. A successful targeted read clears that
message; a replacement refresh clears it only after a successful page response.
All progress calculations remain separate from phone upload-transfer progress.

The additive API change is exactly `src/lib/mobile/owner-data.ts`: select the
existing `processing_progress` column
and return allowlisted `processingStatus` plus a finite 0–100
`processingProgress` (or null). Ownership/RLS, bearer auth, pagination, delivery
URLs, schema, workers and existing Web/share pages are unchanged. Internal job
errors, object keys and passwords are not included. Released 2026-10-15 together with the access API (see the release record below).

The isolated source snapshot is
`/private/tmp/ciiya-owner-processing-release.iSL2bz`, based on accepted
`dpl_ADK8s79rqeLYjT1fzH2gAmBEXKaQ`. Its audit checks exactly one source-file
difference and an identical helper hash. It excludes the pending access/password
adapter and every unrelated dirty-workspace change. Offline mobile tests
463/463 and owner-read API tests 13/13 pass, along with mobile/root TypeScript,
lint, the isolated Next.js Production build and iOS bundle export. Live status updates and physical-device layout
acceptance remain pending.

### Historical Web feature inventory — reference only

The inventory below was compared against the accepted Production source for
`dpl_ADK8s79rqeLYjT1fzH2gAmBEXKaQ`, retained at
`/private/tmp/ciiya-mobile-album-edit-release.gt8HwE`, not inferred from the
dirty workspace or from every component/API that happens to exist in source.
This is a source comparison, not a new full Production monitoring run.

| Workflow | Native position | Remaining parity work |
| --- | --- | --- |
| Owner albums and delivery | List/search/create, metadata, existing-photo cover, photo grid/viewer, foreground uploads and copy/share/QR are implemented; combined device acceptance remains partial | Password/download settings, custom cover upload/crop, upload categories and Lightroom `.xmp` preset |
| Owner photo management | ID-stable paging/zoom and loaded-filename/readiness filtering implemented | Web ordering, actual pending/processing/failed status/progress, deliberate retry, confirmed photo/album deletion |
| People and insights | Not implemented | People groups/person photos and album engagement analytics with existing Bangkok-time chart semantics |
| Native client gallery | Preview currently opens the Web gallery; that is transitional Web-assisted access, not native parity | Guest/password entry, gallery updates, Live/Popular, density, hearts, governed individual/ZIP downloads, contact, selfie search and Guest Moments |
| Portfolio | Not implemented | Existing editor fields/assets/order/design/draft/publish/preview/share and public portfolio presentation |
| Profile and activity | Identity and quota display, local sign-out implemented; legal/help/recovery link to Web | Profile/location/avatar editing, profile totals, activity/news/unread notifications and badge, manual TH/EN choice, native signup/recovery |
| Ciiya Sync | Not implemented natively | Desktop setup guidance, owned device status/revoke and explicit pairing approval using the current protocol |
| Plan management | Current plan/quota display implemented | Current supported pricing/billing workflow, subject to a separate mobile/store-policy review; do not revive retired change-plan APIs |
| Admin | Deferred by the owner | Keep operator-only metrics/logs/global actions out of ordinary photographer/client screens |

Production sources of truth for these groups include
`src/components/album-settings-form.tsx`, `upload-photo-form.tsx`,
`cover-crop-upload.tsx`, `reorder-photos-board.tsx`,
`src/app/albums/[id]/people/`, `src/app/albums/[id]/analytics/page.tsx`,
`src/app/share/[token]/page.tsx`, `public-gallery.tsx`, `selfie-face-search.tsx`,
`guest-moments.tsx`, `portfolio-editor.tsx`, `public-portfolio-page.tsx`,
`notifications-list.tsx`, `src/app/me/`, and the Ciiya Sync components/routes.

Earlier proposed implementation groups (superseded by the owner-only scope):

1. Complete album delivery settings, then owner people/analytics read models.
2. Remaining owner photo/upload/cover management with existing processing,
   quota and deletion orchestration; destructive actions get separate review.
3. Profile, notifications, language and Ciiya Sync account workflows.
4. Portfolio editing/publishing, preserving its independent showcase assets.
5. Native guest gallery, password access, reactions/downloads and Moments;
   compatible selfie search requires an explicit biometric/native-engine design.
6. Cross-workflow device acceptance and distribution/policy decisions.

Keep the existing backend, database, R2/Supabase ownership and delivery rules,
workers, quota, and existing Web behavior authoritative. Add bounded native
adapters only where current cookie-auth routes or server-page bootstrap cannot
serve the app. Do not switch all cookie routes to bearer auth, ship service
credentials, or rebuild these systems in the app. Production adapters are
released in separately authorized, isolated batches; new UI alone cannot enable
them. A Web link/fallback is useful but does not close a native-parity item.

Specific semantics to retain:

- Popular guest photos are sorted by views, not hearts. Guest access uses the
  share token and password authorization, independently of owner sign-in.
- Downloads must use existing server delivery-size/original permissions, not
  treat a saved preview as an equivalent original/ZIP export.
- Portfolio showcase assets are intentionally separate from album photos;
  visiting/editing a portfolio must not automatically publish an album.
- Web activity/news realtime notifications do not mean OS push is already
  implemented. Push and direct DSLR-to-iPhone USB capture would be new scope.
  Production camera guidance currently delegates import to desktop Ciiya Sync.
- Dormant AI/reindex/cluster/operator components and retired billing endpoints
  are not confirmed live Web UI requirements merely because their files exist.

### First parity batch: gallery access settings — released 2026-10-15 (see below)

The native password/download editor is prepared at
`src/app/(app)/(albums)/album/[id]/access.tsx`, separate from the already released
title/description editor. It supports download on/off, SD/HD/UHD/original,
password on/change/off and keeping an existing protected password with a blank
field. A fresh reviewed revision and explicit confirmation precede each write.
Changed settings reset the review; failed/ambiguous acknowledgements require an
explicit reload rather than automatic resubmission. Password drafts stay only
in memory and are cleared when protection is switched off or the visit/account
ends. Unsaved back navigation requires keep/discard; a pending save stays open.

`src/lib/album-access-release.ts` deliberately keeps the live access gate
**false**, independently of the enabled metadata/cover gate. The normal account
cannot invoke either new access GET or PATCH before token lookup/fetch; the
metadata screen shows a disabled preparation entry. Demo changes are in-memory
only and never grant a real gallery permission. All access transports capture
the expected owner and a permanent visit predicate, and recheck after token
refresh, immediately before fetch, after headers/body and before publication.

The pending server adapter adds exactly two runtime files:
`src/app/api/mobile/albums/[id]/access/route.ts` and
`src/lib/mobile/album-access.ts`. GET returns only display settings and an
opaque revision, never passwords/hashes. PATCH is bearer-only, active-owner/RLS
scoped, accepts only access fields, mirrors the Web's bcrypt-cost-10 and derived
original-download flag, and rejects passwords over 72 UTF-8 bytes rather than
silently truncating them. A revision mismatch or exact nullable-field CAS race
returns 409, including a password-only change from the Web. Success requires a
confirmed updated ID. These adapters change no title/description, share token,
publication, schema, worker, storage object, cleanup gate or browser endpoint.

Verification for this local batch: 452/452 offline mobile regressions, including
33 access transport and 23 rendered access-screen contracts, pass. Mobile
TypeScript/lint and the 94 offline server access contracts pass; the new server
files also pass root TypeScript and targeted lint. The local Ciiya iOS Metro
bundle compiles with the closed gate. These checks are not authenticated live
access-change or physical-device acceptance. No new native module, binary
installation, live settings write or Production deployment was performed.

Before enabling: obtain separate approval for an isolated access-API release,
build and verify it against the accepted baseline, run denial/scope checks, then
enable the native gate and let the owner deliberately test on a disposable
album. Do not deploy the dirty checkout or automatically change an album's
password/download settings to demonstrate the feature.

### Separately authorized access + processing-status release — 2026-10-15

The owner explicitly authorized deploying the prepared access (password/download)
API and the processing-status read change. Deployment
`dpl_EaHBkKKQYWUGpZ5fHSHhCvbud3Mo` is READY and promoted on `www.ciiya.app` and
`ciiya.app`; it supersedes `dpl_ADK8s79rqeLYjT1fzH2gAmBEXKaQ`. Its source is an
isolated copy of that accepted deployment's source plus exactly three files:
`src/app/api/mobile/albums/[id]/access/route.ts`, `src/lib/mobile/album-access.ts`
and `src/lib/mobile/owner-data.ts`. A hash audit confirmed no other file changed;
packages, `next.config.ts`, `vercel.json`, the shared cookie auth helper and the
browser settings/cover/delete routes are identical. The dirty checkout and `main`
were not deployed. It was staged with `--skip-domain` (deployment protection kept,
no bypass token), confirmed READY, then promoted.

Before release, a read-only production probe confirmed `processing_progress` and
the access columns exist, all albums are `active`, and no password hash or
download size has an unexpected shape. The isolated Next 16.3.8 build passed, and
30 absent/malformed/forged-credential checks passed locally and again on
production (26×401 private/no-store, 2×405 for unsupported methods, health and
home 200). The first 46 production request logs were all info, without 5xx.
No real credential was used and no album setting was changed by the agent.

The native access gate (`src/lib/album-access-release.ts`) is now enabled; 463
offline regressions, TypeScript and Expo lint pass, and the running dev-client
Metro server serves the enabled gate. Physical-device acceptance is the owner's
next step: on a disposable album, turn protection on with a new password, change
it, keep it with a blank field, turn it off, and switch download sizes; then open
the share link in a private browser to confirm the gallery asks for the password.

### Owner reprocessing of failed photos — released 2026-10-15

The album screen offers "process failed photos again" for loaded failed/stopped
photos (confirmation, sequential requests, at most 50 per tap, stop on account or
album change, outcome summary). The route is
`POST /api/mobile/albums/[id]/photos/[photoId]/retry` (`src/lib/mobile/photo-retry.ts`):
bearer-only, ownership read under RLS with the user's client, only failed/cancelled
photos whose original (and preset) still exist, per-owner rate limit. The live
database allows one `photo_jobs` row per photo (`uq_photo_jobs_photo_id`), so the
route resets that row with a compare-and-set on its status instead of inserting
another job; size, preset and paths are not changed. The photo becomes pending only
while still failed/cancelled. Note: the website's own `/api/photos/retry-processing`
inserts a new job and therefore conflicts with that index; it was not changed here.

With the owner's explicit approval, `dpl_2GTcCGARzJMsEqt4nRY338ANeZCq` was built from
the `dpl_EaHB…` source plus exactly the route and its helper (hash audit), staged
with `--skip-domain` (protection kept, no bypass), then promoted to `www.ciiya.app`
and `ciiya.app`. 37 absent/forged-credential checks pass locally and on production;
the first 50 production logs are info with no 5xx. Offline: 15 server contracts,
473 mobile regressions, TypeScript and lint. Demo mode verified the flow in the iOS
Simulator. The native gate (`src/lib/photo-retry-release.ts`) is enabled. Device
acceptance: retry a genuinely failed photo in a disposable album and confirm the
worker completes it.

### Lightroom presets for phone uploads — released 2026-10-16

The upload sheet lists the album's presets (its own plus account-wide legacy ones),
remembers the last choice per album and can add a new `.xmp` from Files. The chosen
preset is journaled with each queued photo and sent as `presetPath` to reserve and
finalize, where the existing routes validate it. Route:
`GET/POST /api/mobile/albums/[id]/presets` (`src/lib/mobile/album-presets.ts`):
bearer-only, ownership under RLS, list limited to paths the upload routes accept,
POST takes one XMP packet up to 2 MB, checks quota, registers it in
`storage_assets` like the website and removes the object if registration fails.

With the owner's explicit approval, `dpl_CfxwZnUM2v8QtsQ6ntPYZGRWmFdi` was built
from the `dpl_2GTc…` source plus exactly those two files (hash audit), staged with
`--skip-domain`, then promoted. 49 absent/forged-credential checks pass locally and
on production; the first 50 production logs are info with no 5xx. Offline: 9 server
contracts, 479 mobile regressions, TypeScript and lint; demo mode verified listing,
adding a synthetic `.xmp` from Files, and the saved per-album choice in the iOS
Simulator. Device acceptance: add a real Lightroom preset, upload a test photo with
it and check the processed preview shows the adjustment.

### Photo deletion from the viewer — released 2026-10-16

The viewer's top bar has a delete button with a destructive confirmation naming
the photo, a single-flight fence and a re-check of the account/album before
sending; it is disabled for photos still processing. A 404 is treated as already
deleted. Route: `DELETE /api/mobile/albums/[id]/photos/[photoId]`
(`src/lib/mobile/photo-delete.ts`): bearer-only, album and photo ownership under
RLS, refuses pending/processing photos, then exactly the website's deletion flow
(stage storage jobs → locked `delete_photo_complete` RPC, which also clears the
cover → activate/run jobs; unfinished storage stays queued; a failed RPC discards
the staged jobs). Rate limited per owner.

With the owner's explicit approval, `dpl_37iBXvuGEuLqYuM79ftHzpUmdSFo` was built from
the `dpl_6RGb…` source plus exactly those two files (hash audit), staged with
`--skip-domain`, then promoted. 62 absent/forged-credential checks pass locally and
on production; the first 50 production logs are info with no 5xx. Offline: 9 server
contracts, 486 mobile regressions, TypeScript and lint; demo mode verified the
confirmation, removal and the disabled state for a processing photo. No production
photo was deleted by the agent. Device acceptance: delete one photo in a disposable
album, confirm it is gone from the website and the share page, and that the album
cover/count update.

### Select and delete several photos — app only, 2026-10-16

"Select" on the album screen enters selection mode: tap photos (or "select all
loaded") to mark them, up to 100 per batch; photos still processing cannot be
selected. "Delete N" asks for a destructive confirmation, then deletes one photo at
a time through the already released `DELETE /api/mobile/albums/[id]/photos/[photoId]`
(`src/lib/photo-bulk-delete.ts`). It stops if the account/album changes, on sign-out
or after three consecutive network failures, counts already-gone photos as removed,
never assumes a failed request deleted anything, keeps unfinished photos selected and
summarizes the outcome. No server change or deployment was needed. 491 offline
regressions, TypeScript and lint pass; demo mode verified selection, the disabled
processing tile, confirmation and removal.

### Process finished photos again — released 2026-10-16

In selection mode a round "process again" button re-renders the selected finished
photos with their current preset (for example after the worker's preset fix). The
photo stays `done` and visible with its current image; a small spinner marks it and
the feed polls it until its image URL changes (15-minute watch). Up to 100 per batch,
one request at a time (`src/lib/photo-reprocess.ts`).

Route: `POST /api/mobile/albums/[id]/photos/[photoId]/reprocess`
(`src/lib/mobile/photo-reprocess.ts`): bearer-only, ownership under RLS, only `done`
photos whose `original_path` is still the raw upload under `original/` (rows whose
original was replaced by the baked image are refused, so a preset is never applied
twice), original and preset must exist. It resets the single job row by
compare-and-set with a payload `{ source: 'owner-reprocess', reprocess: true,
revision }` and never touches the photo row.

The photo worker (`src/lib/photo-reprocess.ts`, `photo-worker-plan.ts`) writes every
derived object under a new key carrying the revision, because previews are served
`immutable`; it keeps the photo `done`, keeps faces (only the face job's source
moves), commits the new paths, moves a stored album cover, then deletes the previous
render. A failed reprocess leaves the photo and its old render untouched and removes
its own uploads only on final failure; a photo deleted mid-render leaves no new
objects.

With the owner's explicit approval, the worker went first: Railway deployment
`67b9d01e` is the running `origin/main` tree (a0a8260) plus exactly the four worker
files, deployed with `railway up` (the service otherwise auto-deploys from GitHub
`main`). Then `dpl_8LrpUhkZToRnHVPrHahmEWLJaxng` was built from the `dpl_azvK…`
source plus exactly the route, its two helpers and `photo-retry.ts` (exports only),
hash-audited (631 files), staged with `--skip-domain` and promoted. 69 absent/forged-
credential checks pass locally and on production; the first 50 production logs are
info with no 5xx. Offline: 15 route contracts, 6 worker runs against an in-memory
store with real sharp, 7 helper tests, 504 mobile regressions, TypeScript and lint;
demo mode verified the confirmation, the spinner and its clearing on the new image.
Device acceptance: select one photo uploaded with a preset before the fix, process it
again, and check the phone, website and share page all show the new render.

### Earlier working phases for the first photographer release

The owner asked to continue phase 4 on 2026-10-14. These six phases group the
current work; they are not the storage-migration phase numbers or a claim of
full website feature parity.
The owner initially requested existing Web workflows, starting with post-upload
copy/share/QR controls, then narrowed the target to necessary signed-in owner
workflows. Guest/shared-link pages are already accepted and excluded. Phase 4
stays open for the individually agreed owner additions; full Web parity is not
the completion criterion.

1. App foundation, installed development build and sign-in: implemented;
   lifecycle/failure acceptance remains in the combined checklist.
2. Owner-scoped API/security integration: implemented and separately released
   only within the approved read/create/R2-upload/metadata/cover scopes.
3. Core albums, uploads and viewer: implemented; the owner accepted three-photo
   upload/viewing and the paging fix on the iPhone.
4. Delivery review, metadata/cover, account/storage information, local photo
   search/readiness and metadata draft UX: implemented locally. The extra flows
   still require combined physical-device acceptance.
5. End-to-end device testing, reliability/accessibility review and fixes: pending;
   offline tests and compilation do not replace this phase.
6. Beta/store distribution: pending, including owner signing/distribution choices
   and policy/privacy review. The later local development update was separately
   authorized below; no cloud/store submission authorization is inferred.

## Verification record — 2026-10-14

The local iOS Debug build succeeds on Xcode 27 with 0 errors and 0 warnings.
CocoaPods and the React Native/Hermes artifacts are now available locally.
Xcode Personal Team automatic signing generated the development certificate and
profile with the owner's permission. The signed `Ciiya.app` passes
`codesign --verify --deep --strict` and is confirmed installed on the physical
iPhone 16 Pro as `app.ciiya.mobile`, version 1.0.0 / build 1.

The first automated launch was denied by iOS with a security/profile-trust
message; the owner must establish trust on the iPhone before app launch can be
accepted. Google login, live albums/uploads, and physical-device gestures remain
unverified. After trust was established, the original bare Debug app opened
but reported `No script URL provided`; the local Metro server was running.
The SDK-compatible development-client launcher was subsequently built and
installed on the same iPhone. Its build has 0 errors and one non-blocking
dependency-analysis warning for Expo's Release local-network stripping phase.
The CLI's installation/launch step completed without an error and Metro is
running on the LAN. The owner's subsequent screenshot confirms that the native
Albums screen renders on the physical device; its initial data request failed
because production did not yet have `/api/mobile/albums` (HTTP 404).
Google login and authenticated album data remain separate acceptance steps.
Supabase's exact `ciiya://auth/callback` redirect was added with the
owner's explicit permission while preserving the Site URL and existing redirects.
All 151 offline regressions, TypeScript and lint pass; they do not prove live
authentication or production data workflows.

With the owner's explicit deployment permission, the mobile read API was
released to Vercel Production as `dpl_3gZQZqrhCYY8nzEQK4Ysyu82SAU2` on
2026-10-14. Its isolated source is production base `7a70a91` plus six runtime
files: the three mobile album GET routes, owner read models, the bearer parser,
and `src/lib/mobile/server-client.ts`. The dedicated helper is token-only,
verifies identity with `getUser()`, and never falls back to browser cookies.
The deployed shared web auth helper, packages/lockfile, environment, database,
workers, storage gates and existing web source remain unchanged. Other dirty
workspace edits were not deployed, and no production data was modified.

Verification: 12 offline release/security tests, Next 16.3.8 build/typecheck and
targeted lint passed. All 151 mobile offline regressions, mobile typecheck and
Expo lint pass. The production domain now serves the three mobile routes as
private/no-store JSON 401 for missing/malformed/unverifiable credentials rather
than 404; existing public pages return 200. The health monitor reports `ok` and
the first 17 current-deployment request logs contain six 200 and eleven expected
401 responses, without 5xx or runtime warning/error entries. The owner has now
confirmed that the album list opens successfully on the physical iPhone. Photo
grid/viewer acceptance, fresh OAuth lifecycle tests, and native uploads remain
unverified. Creation/upload bearer authentication is not part of this read-only
release and requires a separate production authorization before deployment.
The staged URL retained Vercel Deployment Protection; no bypass token was
created and no protection was disabled.

Run the durable offline owner-read regression from the repository root with
`node --test scripts/test-mobile-read-api.cjs` (Node 24). The exact isolated
release and scope-verification artifacts are retained locally under
`/private/tmp/ciiya-mobile-api-release.Bojp0d` for traceability. Do not redeploy
the whole dirty workspace as an equivalent release.

### Separately authorized creation/R2-upload release

On 2026-10-14 the owner explicitly authorized mobile album creation and R2
uploads, preserving browser/Sync behavior and storage gates, without deleting
existing originals; the human selects and confirms actual test photos.
Deployment `dpl_CzYhbuUHN6rSJZApk19scyXUtrf8` was Ready and promoted on
`https://www.ciiya.app`; the metadata/cover release below subsequently supersedes
it without changing its existing runtime files. The isolated source at
`/private/tmp/ciiya-mobile-write-release.GptYub` changes exactly five runtime
files relative to the accepted read-only release: the dedicated mobile client,
album creation, upload principal, upload URL cancellation guard, and finalizer.

Native creation/upload uses the verified JWT's own public-key client, never
the supplied browser-cookie identity. Explicit empty/malformed/invalid headers
cannot fall back to cookies. Native finalization rejects non-R2 storage; native
JWT DELETE is denied before request-body, cancellation RPC or object access.
The shared cookie helper, Sync scopes/rollout, storage adapters, SQL, environment,
packages and worker deployments are unchanged. Existing website album defaults
remain public with automatic publication and face scanning enabled; first
device tests should use a non-sensitive image. Settings, cover/deletion, billing,
cloud/store distribution and destructive storage operations are outside this
deployment. The native transport's safety changes are JavaScript-only; no new
native dependencies, signing credentials or app binary were required.

Verification: 31 offline write/auth/provider/cancellation contracts, 12 offline
read contracts, 159 mobile regressions, web/mobile typecheck, lint and Next build
pass. Existing storage/quota/session/idempotency/Sync offline suites pass.
Production negative-auth smoke tests use synthetic invalid credentials and
empty bodies only: all 20 write-route requests are rejected with 401, without
creating albums, reservations or photos. Existing read/page smoke and the health
monitor pass. R2 preflight reports 10 passes, two unchanged expected warnings,
zero failures, rollout enabled and zero failed/copying/verifying migrations.
Actual authenticated creation, photo transfer and worker completion on the
iPhone remain human acceptance steps, not proven by these tests.

Run `node --test scripts/test-mobile-write-api.cjs` from the repository root
with Node 24 to exercise the durable offline server regressions.

### Subsequent physical-device acceptance and delivery review

The owner subsequently confirmed that three photos were uploaded from the
iPhone, opened successfully, and supported zoom in/out/reset and closing the
viewer. A read-only check correlated three new photos in one album with three
completed Photo Worker and three completed Face Worker jobs. R2 HEAD metadata
confirmed all three originals, previews and thumbnails existed with nonzero
sizes matching their nine database size records. No failed/stale jobs were
present. This supersedes the earlier pending creation/upload/viewer acceptance
notes; it does not establish every OAuth lifecycle or failure-recovery scenario.

The owner then reported slight horizontal paging stutter. The JavaScript-only
viewer patch keeps each image mounted while selection changes, removes the
image fade, resets zoom on new visits and fences old activation callbacks.
Its 33 viewer regressions and the then-current 169 mobile tests passed, with
TypeScript, lint and local iOS Metro compilation. The owner explicitly confirmed
the updated viewer worked well. This is device acceptance, not a measured FPS
claim, and no native binary or backend deployment was involved.

The subsequent delivery review is also local JavaScript only, reusing installed
React Native Share and Expo WebBrowser modules. Its action/security and rendered
screen tests use mocked native/network I/O; the actual native share sheet and
gallery preview on the iPhone remain the next human acceptance steps. No link
was sent to a recipient by the agent. Settings, cover changes, album deletion,
publication changes, billing and cloud/store distribution remain separate gates;
this review does not deploy or enable those server mutations.
The combined 228 offline mobile tests (36 delivery action contracts and 23
rendered-screen contracts), TypeScript and Expo lint pass. Local Metro on port
8083 successfully compiles the new iOS route and review/auth guards. No native
dependencies, signing setup, app binary or production deployment changed.

### Initial local metadata/cover preparation — subsequently released below

The next batch is deliberately limited to album title, description and selecting
an existing ready photo as the cover. It does not edit password protection,
download permissions, publication, ownership, storage objects or worker jobs.
The settings screen displays loaded sharing flags read-only and has no album
deletion control. Those flags are informational, not proof of anonymous access.

The new token-only PATCH routes are `/api/mobile/albums/[id]/details` and
`/api/mobile/albums/[id]/cover`. Details accepts only title/description; cover
accepts only a photo ID. Both verify the JWT, exact owner and active album,
apply RLS and confirm an actual updated row before acknowledging success. Cover
selection requires a ready photo in that owned album and resolves an owned public
preview/thumbnail path; it cannot publish an original or reuse a signed URL.
Existing browser settings/cover/delete routes and cookie authentication remain
unchanged. Offline server tests use mocked clients and perform no live mutations.

During initial preparation, `src/lib/album-edit-release.ts` kept the native edit
gate false. Live methods stopped before token lookup or fetch, and controls
displayed a not-yet-enabled message. Demo fixtures exercised the prepared flow
without a real account or network. The separately authorized server release below
now enables the gate after production denial checks; authenticated physical-device
acceptance remains pending. Building or reloading JavaScript does not deploy APIs.

Combined device checklist (the owner will check these together later):

- Delivery review: open an existing gallery, open/cancel the native share sheet,
  then test a settings/token change while reviewing; no cached-token fallback.
  In the upload queue, copy the link and paste it deliberately into a trusted
  place; do not send it merely to prove a test. Show the QR and check that scanning
  opens the same gallery, then download the SVG using Save to Files and verify
  that the saved file opens/scans. Cancel the save/share menu once and confirm
  that the app does not claim the QR was saved or a recipient received it.
- Metadata: change title/description, save once,
  return to album/list and confirm the refreshed values; test blank title and a
  failed acknowledgement without automatically repeating a write.
  Check character counters and unsaved status. Try back/swipe-back, choose keep
  editing and confirm the text remains; use discard only on a disposable draft
  and confirm the stored album is unchanged. While waiting for a save, back must
  show inline guidance rather than leaving or showing a lingering native alert.
  A successful save must return normally without an extra discard prompt.
- Cover: select a ready photo, confirm the refreshed
  list cover, swipe during a pending selection and verify the result refers only
  to the selected photo. Processing photos cannot be selected as covers.
- Sign-out/account changes or leaving a form during an in-flight action must not
  navigate or show a successful result in another account or album.
- Upload review: during the next intentional test batch, open the queue details,
  check waiting/sending/registering/stored counts, and cancel a removal dialog.
  Use only a disposable queued test copy if confirming removal; verify the photo
  library original remains. A dialog opened before registration or before leaving
  the screen must not remove a now-finished item or act after returning. Do not
  re-upload real accepted photos merely to test a failure or missing acknowledgement.
- Account: compare used/remaining capacity with the current owner's website,
  refresh while idle and check the stale-data warning if a read fails. Missing
  quota data must not appear as Free/zero usage or unlimited space. Cancel the
  sign-out dialog first; confirm only when ready to test signing into the same
  account again. If using another test account, read the local-queue removal
  warning and verify no earlier account's profile/usage reappears. Do not send
  account screenshots containing personal information merely to prove these checks.
- Photo browsing: try Thai/English filename search, clear the query, combine it
  with ready/not-ready filters, and reset a no-match result. If more pages exist,
  load them deliberately and confirm the counts describe the loaded set. Open a
  filtered photo and swipe/zoom while an unfinished photo becomes ready; the
  current image must not jump to a different ID. Check keyboard/layout on the
  iPhone and confirm the search/filter resets after changing album or account.

Physical acceptance of delivery and metadata/cover is still pending. The already
accepted upload/viewer checks above are not replaced by this pending checklist.

Initial local verification for this batch: 266 mobile regressions (including 38
viewer and 13 cover-lifetime tests) and 76 server read/write/edit contracts pass
offline. Mobile TypeScript and Expo lint, root TypeScript/targeted lint and the
Next 16.3.8 build pass. The current iOS Metro bundle compiles successfully with
the closed edit gate, metadata form, cover context fence and delivery review.
Cover callbacks and their captured predicates cannot revive after a same-account
logout/return or blur/refocus; closing/unmounting prevents late saved/error UI,
and an old account/album completion cannot trigger the current album's refresh.
None of these checks is authenticated production edit/cover acceptance. No
deployment, environment, signing, native dependency/binary or storage deletion
was performed for this batch.

### Separately authorized title/description/cover release

The owner explicitly authorized deploying only these two APIs on 2026-10-14.
Deployment `dpl_ADK8s79rqeLYjT1fzH2gAmBEXKaQ`, created at 15:23:29 Bangkok,
is READY/PROMOTED and freshly verified as the deployment serving
`https://www.ciiya.app`. Its isolated source is
`/private/tmp/ciiya-mobile-album-edit-release.gt8HwE`, cloned from the preceding
accepted creation/R2-upload release rather than the dirty workspace. Exactly
three runtime files were added: the details route, cover route and shared
`src/lib/mobile/album-edit.ts` validator. No existing baseline runtime file was
changed or removed. Browser cookie auth/settings/cover/delete routes, packages,
environment, database schema, Railway workers and storage gates remain unchanged.

The isolated Next 16.3.8 build/typecheck and targeted lint pass, as do all 76
offline server read/write/edit contracts. Production smoke rejects ten absent or
invalid-auth PATCH requests with private/no-store JSON 401 and both unsupported
GET requests with 405. Existing read/page/health smoke also passes. Staging
deployment protection remains enabled; no bypass token was created. No actual
owner credentials, album edits, cover changes or object deletions were sent by
the agent.

After that verification, the local native JavaScript gate was enabled. All 266
mobile regressions, TypeScript and Expo lint pass. Metro's current iOS bundle
compiles with the enabled gate, metadata form, cover context guard and delivery
review. Full-settings/password/download edits and album deletion still throw
before token lookup or fetch. No native dependency, signing or app binary changed.

Current-release Vercel logs contain 28 positive records (six 200, twenty expected
negative-auth 401 and two expected method 405), all info, from 08:29:39 to
08:30:49 UTC. Successful error/warning/fatal/5xx queries found no matches in the
available current-deployment window. Post-release public health returns 200/ok;
both worker roles have fresh online heartbeats, and recorded open storage issues
are zero. These scoped release checks do not advance the full production-monitor
watermark or establish deployment-lifetime log coverage.

Reload the existing Ciiya development build to use the updated JavaScript. The
combined checklist above is still pending human device acceptance; offline tests
and negative-auth smoke are not proof of an authenticated save or cover change.
The redacted release receipt is retained at
`/private/tmp/ciiya-mobile-album-edit-release-receipt.json`.

### Subsequent native upload-review batch — no server deployment

The next local JavaScript batch adds a six-state queue overview, file size,
foreground/processing guidance, explicit retry buttons and two-button native
removal confirmation. Progress is clamped to finite 0–100 values. Held legacy
journals are visibly retained, do not trigger preview-file reads and are excluded
from bulk UI retry. The review preserves registration intent and rechecks the
current photo before accepting a confirmation, including completion during an
open dialog. It reuses the tested read-only account/album/focus lifetime fence;
old callbacks cannot revive after leaving and returning to that context.

All 290 offline mobile regressions pass (24 new review/screen/bulk-retry checks),
with mobile TypeScript and Expo lint. The existing Ciiya Metro manifest and iOS
bundle return 200 and contain the new review/controller/confirmation code plus
the still-enabled metadata/cover gate. No native dependencies, signing, binary,
backend release, environment, storage objects or live queue data were changed
by the agent. Automatic transport retry/concurrency, idempotent upload IDs,
remote discard no-op and the underlying queue cancellation primitive retain
their previous behavior; the review limits which human actions reach them.
Actual iPhone alert/layout/queue behavior remains part of the combined human
checklist, not proven by the mocked callback tests or Metro compilation.

Redacted local receipt:
`/private/tmp/ciiya-native-upload-review-20261014T085604Z.json`.

### Subsequent account/storage-information batch — no server deployment

The account screen is keyed by owner and has its own focus-scoped, single-flight
read controller. It pins the existing `user_storage_usage` SELECT to the expected
SDK owner, retaining server RLS without quota/billing changes. SDK identity
events clear cached data and fence old completions before React changes screens;
A → null → A is a new lifetime, while same-owner token refresh preserves the
current read. Reads start outside the synchronous auth callback and have a
30-second UI deadline. Blur/unmount/identity transitions cancel local publication
and release the controller's timer, not an already-issued SDK network request.
Late responses cannot populate the new account/focus lifetime.

Missing rows, malformed numbers/plan and authoritative query 401 responses are
errors rather than fabricated Free/zero usage. Valid zero used bytes remain
valid; absent/zero capacity is shown as unknown, never unlimited. The display
shows remaining space, bounded percentages and near-full/full guidance; cached
own-account data is explicitly labeled after a failed refresh. Unknown plan
identifiers are not shown raw. Public support/privacy/terms links remain fixed
paths, opened only on a human tap, with no private account query parameters.

Local-device sign-out now has a two-button confirmation explaining queue pause
and the existing different-account local-queue policy. It remains the existing
provider's `scope: 'local'` operation, synchronously single-flight and fenced by
the account/focus lifetime. Cancel/dismiss invokes no auth action; stale dialogs
and late outcomes cannot act on a new context. No account deletion, subscription
change, checkout, stored-object removal or server sign-out-all action was added.

All 327 offline mobile regressions pass, including 37 new model/read/hook/action
and rendered-screen checks. Mobile TypeScript, Expo lint and the existing Ciiya
iOS Metro manifest/bundle pass. Metadata/cover editing remains enabled and the
previous upload review still compiles. No backend deployment, environment,
native dependency/signing/binary, production quota or live auth action was
performed by the agent. Actual iPhone account layout/quota/sign-out acceptance
remains part of the combined human checklist above.

Redacted local receipt:
`/private/tmp/ciiya-native-account-review-20261014T092520Z.json`.

### Subsequent photo-browse batch — no server deployment

The album grid now searches only filenames in its existing loaded feed, with
Unicode-normalized Thai/English terms and ready/not-ready filters. Search never
serializes a query into an API request or searches private IDs/URLs. Loaded
counts, an explicit remaining-pages hint and a no-match/reset state avoid
claiming a complete-album result. Filtered short or empty lists do not trigger
automatic pagination; the human can use the existing cursor through a load-more
button. Existing unfiltered pagination and bounded processing polls are retained.
Readiness is the existing boolean, not a worker-health or failed-job report.

A filtered viewer snapshots photo IDs at opening, preserving its order while
using the latest previews/readiness by ID. A missing selected ID permanently
dismisses that session rather than shifting a numeric index or reviving later.
Owner/album-keyed screens and the existing immediate SDK/focus lifetime fence
reject stale tile/cover callbacks; closing or replacing a viewer also fences
its queued cover action and late refresh. Each deliberate opening has a new
viewer session key. The accepted PhotoViewer gesture, zoom and image-fade code
is unchanged; this batch changes its parent selection integration only.

All 349 offline mobile regressions pass, including 22 new pure-model/rendered
screen checks. Mobile TypeScript and Expo lint pass without diagnostics. The
verified local Ciiya manifest and iOS Metro bundle both return 200; the compiled
bundle contains search, frozen selections and loaded readiness, alongside the
account/upload-review code and still-enabled title/description/cover gate. A
read-only source-isolation audit confirms the previous three-file API release
overlay still matches and its protected baseline is unchanged. This is not a
new production deployment or a fresh full production-health check.

No backend/API changes, environment changes, native dependencies/signing/binary,
live photo/queue/account mutations, job retries or storage deletion were performed
by the agent. Actual iPhone search/keyboard/layout and filtered swipe acceptance
remain in the combined human checklist above; mocked regressions and Metro
compilation do not establish physical-device acceptance.

Redacted local receipt:
`/private/tmp/ciiya-native-photo-browse-20261014T095119Z.json`.

### Phase 4 metadata-draft UX batch — no server deployment

The metadata form now includes Thai/English character counters, edited/unchanged
status and an explicit memory-only draft notice. Unsaved text triggers a native
two-button confirmation on stack removal. Cancel/Android dismissal keeps the
draft; discard repeats the exact original navigation action once, preserving
SDK navigation symbols, and fences queued saves/inputs before the route unmounts.
Repeated back attempts share one confirmation. Editing again, starting a save,
SDK owner transitions, blur/refocus and unmount invalidate old discard tickets.
Same-owner token refresh does not invalidate a current deliberate confirmation.
Cached detail refreshes do not overwrite the original draft baseline or text.

During a save, removal shows inline waiting guidance instead of a native waiting
alert that could cover the destination after completion. An acknowledged current
save bypasses the old enabled hook and returns once; a failure retains the draft
for deliberate retry. A save callback captured before a newer text event cannot
submit its stale text. The existing narrow details endpoint, validation limits,
single-flight write and account/focus acknowledgement fences remain in force.
No auto-save, persisted draft, conflict-resolution promise, remote cancellation,
sharing-flag change or destructive action was added. Navigation prevention does
not prevent app exit/crash, tab blur without removal, or conditional/auth unmount.

SDK 57 uses `usePreventRemove` from the documented `expo-router/react-navigation`
compatibility entry point, not the different SDK-58 root API. The installed
hook/provider/listener and exact-action repeat behavior are covered offline:
[SDK 56+ import migration](https://docs.expo.dev/router/migrate/sdk-55-to-56/),
[SDK-58 removal API distinction](https://docs.expo.dev/router/advanced/prevent-screen-removal/).

All 366 offline mobile regressions pass, including 15 additional form contracts
and two installed-SDK navigation compatibility contracts. TypeScript and Expo
lint pass without diagnostics. The prior local Metro server was stopped; it was
started again for this Ciiya workspace at the same port 8083, without changing
environment files, native dependencies, signing or app binary. The verified Ciiya
manifest/iOS bundle return 200 and include draft/exit/inline-waiting code plus
the previous search/account/upload-review and enabled metadata/cover gate.
The previous three-file API source-isolation audit still matches its accepted
overlay with its protected baseline unchanged. No deployment, live album edit,
queue/account mutation, worker retry or storage deletion was performed. This
batch does not advance the full production-monitor watermark. Native alert,
swipe-back and layout acceptance remain in the owner's combined device checklist.

Redacted local receipt:
`/private/tmp/ciiya-native-phase4-draft-20261014T100959Z.json`.

### Requested web parity: post-upload copy/share/QR — local native update

The owner explicitly requested the web's post-upload delivery controls and
approved rebuilding/installing the development app on the iPhone. A shared
`AlbumDeliveryPanel` now serves both the delivery route and upload-queue header:
share link, copy link, show QR and download QR. The controls remain reachable
when local queue history is empty/cleared. Only a settled local batch without
active, failed or held items gets the completion heading; the existing caveat
about stored originals versus processed previews remains visible.

Every deliberate handoff reads the owned album again. Changed sharing flags or
tokens update the review first and require another tap. The existing lifecycle
controller and read-only account/album/focus capture prevent stale retained
buttons, pending reads or QR generation from reviving after a different visit.
Copy confirmation appears only after the current clipboard write returns true
and is tied to its exact URL, not a later rotated link. Missing modules in an old
development binary disable copy/export without crashing startup; mandatory native
imports are deferred until an intentional action. Pending native operations stay
single-flight until they settle, without a timeout that opens a second sheet.

`expo-clipboard` 57.0.2 and `expo-sharing` 57.0.23 were installed with Expo's SDK
resolver; the pure-JS `qrcode` 1.5.4 encoder and its declarations were also added.
The Sharing plugin explicitly disables incoming share extensions on both platforms:
no app group, new account or paid capability is requested. QR SVGs encode only the
canonical existing gallery URL, with a white four-module quiet zone. Byte segments
avoid a browser TextEncoder dependency. There is no external QR service, original
photo URL, password or bearer credential in the artifact.

QR export creates one new, generic-name SVG in the app's cache and presents the
native save/share menu with SVG MIME/UTI. It deletes only its own newly created
artifact if invalidated before handoff. A handed-off file remains OS-evictable
because a recipient app may consume it after Android's promise resolves. No
existing cache files, photo-library originals, upload journals or storage sources
are swept. Native completion/cancellation is not reported as a saved file or
delivery receipt. No live link was copied/exported/sent by the agent.

All 396 offline mobile regressions pass (30 new action/adapter/QR/screen/header
contracts), along with TypeScript and Expo lint. The actual browser QR encoder
is tested offline, with native/file/clipboard/queue boundaries mocked. The Ciiya
Metro manifest and iOS bundle return 200 and include the new controls/modules,
previous photo search and the enabled metadata/cover gate. Local CocoaPods and
the Xcode Debug build succeed; the new Clipboard/Sharing classes are registered
in the generated Expo module provider. `codesign --verify --deep --strict` and
the exact bundle ID/team checks pass.

The verified `app.ciiya.mobile` build was installed as an in-place update on the
uniquely identified, paired, wired iPhone 16 Pro. The install result confirms that
bundle ID. No uninstall, data wipe, new signing/provisioning request, cloud build
or store submission was performed. Actual device copy, SVG preview/scanning and
Save-to-Files acceptance remain human checks. The prior API source-isolation audit
still matches; no server deployment, environment, sharing/publication permission,
worker job, migration/cleanup gate or production-monitor watermark changed.

Redacted local receipt:
`/private/tmp/ciiya-native-post-upload-delivery-20261014T105223Z.json`.

## Verification record — 2026-10-11

The photographer-workflow changes pass 150 offline mocked regression tests,
TypeScript and lint. Production Hermes bundle exports pass for iOS and Android
with demo mode disabled; this does not produce an installable APK/IPA.

iOS 18.6 / Expo Go 57 demo checks: Thai text search (`เขาใหญ่`), no-match/clear
states, name sorting, create → album navigation, selection of three simulator
sample photos, upload guidance and simulated queue completion with three ready
thumbnails. Delete confirmation was cancelled without deleting any album, and
the settings could then be saved normally.
All mutations used local demo fixtures, not production accounts or objects.

Live authentication/uploads, Android runtime, physical-device gestures and store
distribution are still pending. The preceding release gates remain in effect.

## Verification record — 2026-10-08

All 139 regression tests passed offline with mocked endpoints/files; they do not
prove live Supabase/R2/worker integration. Typecheck, lint and Expo Doctor (21/21)
have passed. Production JavaScript/Hermes exports have succeeded for iOS and Android; no
native APK/IPA, cloud build, signing or store submission has been performed.

An iOS 18.6 Simulator running Expo Go 57 in demo mode was used to verify album
creation, the photo grid loading 58 photos, setting a cover, viewer button
navigation 2 → 3 → 2, zoom buttons/pan/reset, resetting zoom when changing photos,
account usage and sign-out/return to the sign-in screen. This used sample data,
not production accounts or objects. Android runtime acceptance is still pending.

Horizontal drags through the UI automation did not move the native pager, even
in a temporary bare-pager control without child gestures. Those diagnostics were
removed; the cause could not be attributed reliably to the tool or native input.
Do not mark physical swipe/pinch accepted from these tests. Test them with fingers
on real iOS and Android devices before distributing the beta.

Local native build tooling is incomplete: Xcode/Simulator/Node are available,
but CocoaPods and native RN/Hermes dependency caches are not. Prepare that local
toolchain, or approve the Expo cloud/signing setup, before claiming a binary build.

## Dependency security

The scoped `decode-uri-component` adapter wraps unchanged patched upstream 0.5.0
for Router 57's CommonJS caller; `xcode` uses patched CommonJS `uuid` 11.1.1.
Tests cover the actual Router parser and xcode consumer. Keep these overrides
until upstream consumers provide compatible fixes; do not use `npm audit fix --force`.

As of 2026-10-08, the audit still reports 18 high affected-package entries from
two toolchain advisories without a published patch: [braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
and [node-forge](https://github.com/advisories/GHSA-86w9-cpqp-85rv). There are no
remaining moderate entries, but this is **not** a zero-vulnerability claim.
Keep development servers private and build inputs trusted; re-audit before release.

## Branding

App/adaptive/monochrome/splash/favicon assets are deterministic exports of the
existing `public/logo-mark.svg`, replacing Expo template artwork in config.
To regenerate from the repository root (uses the web project's installed Sharp):

```bash
node mobile/scripts/render-brand-assets.cjs
```
