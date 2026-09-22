import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migrationPath = new URL(
  '../supabase/migrations/202609210001_photo_storage_provider_metadata.sql',
  import.meta.url
)
const uploadSessionMigrationPath = new URL(
  '../supabase/migrations/202609210002_r2_photo_upload_sessions.sql',
  import.meta.url
)
const uploadFinalizationMigrationPath = new URL(
  '../supabase/migrations/202609210003_r2_photo_upload_finalization.sql',
  import.meta.url
)
const storageDeletionMigrationPath = new URL(
  '../supabase/migrations/202609210004_storage_deletion_jobs.sql',
  import.meta.url
)
const cameraStorageMigrationPath = new URL(
  '../supabase/migrations/202609210005_r2_camera_live_import.sql',
  import.meta.url
)
const assetStorageMigrationPath = new URL(
  '../supabase/migrations/202609210006_r2_portfolio_guest_presets.sql',
  import.meta.url
)
const consistencyMigrationPath = new URL(
  '../supabase/migrations/202609210007_r2_storage_consistency.sql',
  import.meta.url
)
const photoCopyMigrationPath = new URL(
  '../supabase/migrations/202609210008_supabase_to_r2_photo_migration.sql',
  import.meta.url
)
const sourceCleanupMigrationPath = new URL(
  '../supabase/migrations/202609210009_delayed_supabase_source_cleanup.sql',
  import.meta.url
)
const presetPathValidationMigrationPath = new URL(
  '../supabase/migrations/202609220001_fix_encoded_preset_path_validation.sql',
  import.meta.url
)
const cameraImportUniqueMigrationPath = new URL(
  '../supabase/migrations/202609220002_remove_stale_camera_import_session_file_unique.sql',
  import.meta.url
)
const photoSizeQuotaMigrationPath = new URL(
  '../supabase/migrations/202609220003_ensure_photo_size_quota_trigger.sql',
  import.meta.url
)
const schemaPath = new URL('../supabase/schema.sql', import.meta.url)

const [
  migration,
  uploadSessionMigration,
  uploadFinalizationMigration,
  storageDeletionMigration,
  cameraStorageMigration,
  assetStorageMigration,
  consistencyMigration,
  photoCopyMigration,
  sourceCleanupMigration,
  presetPathValidationMigration,
  cameraImportUniqueMigration,
  photoSizeQuotaMigration,
  schema,
] = await Promise.all([
  readFile(migrationPath, 'utf8'),
  readFile(uploadSessionMigrationPath, 'utf8'),
  readFile(uploadFinalizationMigrationPath, 'utf8'),
  readFile(storageDeletionMigrationPath, 'utf8'),
  readFile(cameraStorageMigrationPath, 'utf8'),
  readFile(assetStorageMigrationPath, 'utf8'),
  readFile(consistencyMigrationPath, 'utf8'),
  readFile(photoCopyMigrationPath, 'utf8'),
  readFile(sourceCleanupMigrationPath, 'utf8'),
  readFile(presetPathValidationMigrationPath, 'utf8'),
  readFile(cameraImportUniqueMigrationPath, 'utf8'),
  readFile(photoSizeQuotaMigrationPath, 'utf8'),
  readFile(schemaPath, 'utf8'),
])

const requiredColumns = [
  'storage_provider',
  'storage_bucket',
  'storage_version',
  'migration_status',
]
const requiredStatuses = [
  'pending',
  'copying',
  'verifying',
  'completed',
  'failed',
]

for (const column of requiredColumns) {
  assert.match(migration, new RegExp(`add column if not exists ${column}\\b`))
  assert.match(schema, new RegExp(`\\b${column}\\b`))
}

for (const status of requiredStatuses) {
  assert.match(migration, new RegExp(`'${status}'`))
}

assert.match(migration, /storage_provider set default 'supabase'/)
assert.match(migration, /storage_version set default 1/)
assert.match(migration, /migration_status set default 'pending'/)
assert.match(migration, /storage_provider in \('supabase', 'r2'\)/)
assert.match(migration, /storage_provider <> 'r2'[\s\S]*storage_bucket is not null/)
assert.match(migration, /idx_photos_storage_migration_queue/)
assert.match(migration, /check \(storage_provider is not null\) not valid/)
assert.match(migration, /validate constraint photos_storage_provider_check/)
assert.doesNotMatch(migration, /\bdrop\s+(table|column)\b/i)
assert.doesNotMatch(migration, /\bdelete\s+from\s+public\.photos\b/i)
assert.doesNotMatch(migration, /storage_bucket\s*=\s*'albums'/i)

for (const sql of [uploadSessionMigration, schema]) {
  assert.match(sql, /create table if not exists public\.photo_upload_sessions/)
  assert.match(sql, /create or replace function public\.reserve_photo_upload/)
  assert.match(sql, /create or replace function public\.cancel_photo_upload_session/)
  assert.match(sql, /pg_advisory_xact_lock/)
  assert.match(sql, /STORAGE_LIMIT_EXCEEDED/)
  assert.match(sql, /photo_upload_sessions_select_own/)
  assert.match(sql, /revoke insert, update, delete on table public\.photo_upload_sessions/)
  assert.match(sql, /p_object_key not like v_expected_prefix \|\| '%'/)
  assert.match(sql, /position\(chr\(92\) in p_object_key\) > 0/)
  assert.match(sql, /v_object_name !~ '\^\[0-9a-f\]/)
  assert.match(sql, /message = 'INVALID_PRESET_PATH'/)
}

assert.doesNotMatch(uploadSessionMigration, /\bdrop\s+table\b/i)
assert.doesNotMatch(uploadSessionMigration, /\bdelete\s+from\b/i)

for (const sql of [uploadFinalizationMigration, schema]) {
  assert.match(sql, /create or replace function public\.begin_photo_upload_finalization/)
  assert.match(sql, /create or replace function public\.complete_photo_upload_finalization/)
  assert.match(sql, /for update/)
  assert.match(sql, /status = 'finalizing'/)
  assert.match(sql, /status = 'completed'/)
  assert.match(sql, /PHOTO_UPLOAD_BINDING_MISMATCH/)
  assert.match(sql, /p\.storage_provider = 'r2'/)
  assert.match(sql, /p\.original_size_bytes = v_session\.expected_size_bytes/)
  assert.match(sql, /revoke all on function public\.begin_photo_upload_finalization/)
  assert.match(sql, /revoke all on function public\.complete_photo_upload_finalization/)
}

assert.doesNotMatch(uploadFinalizationMigration, /\bdrop\s+table\b/i)
assert.doesNotMatch(uploadFinalizationMigration, /\bdelete\s+from\b/i)

for (const sql of [storageDeletionMigration, schema]) {
  assert.match(sql, /create table if not exists public\.storage_deletion_jobs/)
  assert.match(sql, /storage_provider in \('supabase', 'r2'\)/)
  assert.match(sql, /status in \('staged', 'pending', 'processing', 'completed', 'failed'\)/)
  assert.match(sql, /unique \(operation_id, storage_provider, storage_bucket, object_key\)/)
  assert.match(sql, /idx_storage_deletion_jobs_recovery/)
  assert.match(sql, /create or replace function public\.claim_storage_deletion_jobs/)
  assert.match(sql, /for update skip locked/)
  assert.match(sql, /create or replace function public\.recover_staged_storage_deletion_jobs/)
  assert.match(sql, /status = 'failed'[\s\S]*Recovered after interrupted storage deletion/)
  assert.match(sql, /where j\.status = 'processing'/)
  assert.match(sql, /from interrupted i/)
  assert.match(sql, /not exists \([\s\S]*from public\.photos/)
  assert.match(sql, /not exists \([\s\S]*from public\.albums/)
  assert.match(sql, /revoke all on table public\.storage_deletion_jobs from anon, authenticated/)
  assert.match(sql, /to service_role/)
  assert.match(sql, /position\(chr\(92\) in object_key\) = 0/)
}

assert.doesNotMatch(storageDeletionMigration, /\bdelete\s+from\s+public\.photos\b/i)
assert.doesNotMatch(storageDeletionMigration, /\bdelete\s+from\s+public\.albums\b/i)
assert.doesNotMatch(storageDeletionMigration, /\bdrop\s+table\b/i)

for (const sql of [cameraStorageMigration, schema]) {
  assert.match(sql, /camera_live_imports[\s\S]*storage_provider/)
  assert.match(sql, /camera_live_imports[\s\S]*storage_bucket/)
  assert.match(sql, /photo_upload_session_id/)
  assert.match(sql, /create or replace function public\.reserve_camera_photo_upload/)
  assert.match(sql, /create or replace function public\.begin_camera_photo_upload_finalization/)
  assert.match(sql, /create or replace function public\.complete_camera_photo_upload_finalization/)
  assert.match(sql, /create or replace function public\.cancel_camera_photo_upload/)
  assert.match(sql, /CAMERA_UPLOAD_BINDING_MISMATCH/)
  assert.match(sql, /PHOTO_UPLOAD_BINDING_MISMATCH/)
  assert.match(sql, /pg_advisory_xact_lock/)
  assert.match(sql, /grant execute[\s\S]*to service_role/)
}

assert.match(
  cameraStorageMigration,
  /revoke all on function public\.reserve_camera_photo_upload[\s\S]*from public, anon, authenticated/
)
assert.doesNotMatch(cameraStorageMigration, /\bdrop\s+table\b/i)
assert.doesNotMatch(cameraStorageMigration, /\bdelete\s+from\b/i)

for (const sql of [assetStorageMigration, schema]) {
  assert.match(sql, /create table if not exists public\.storage_assets/)
  assert.match(sql, /asset_kind in \('portfolio', 'guest_moment', 'preset'\)/)
  assert.match(sql, /storage_provider in \('supabase', 'r2'\)/)
  assert.match(sql, /status in \('uploading', 'active', 'failed', 'deleting'\)/)
  assert.match(sql, /unique \(storage_provider, storage_bucket, object_key\)/)
  assert.match(sql, /storage_assets_select_own/)
  assert.match(sql, /revoke insert, update, delete on table public\.storage_assets/)
  assert.match(sql, /create or replace function public\.update_storage_after_asset_change/)
  assert.match(sql, /create trigger trg_storage_asset_usage/)
  assert.match(sql, /storage_asset_ids uuid\[\]/)
  assert.match(sql, /from public\.storage_assets sa/)
}

assert.doesNotMatch(assetStorageMigration, /\bdrop\s+table\b/i)
assert.doesNotMatch(assetStorageMigration, /\bdelete\s+from\b/i)

for (const sql of [consistencyMigration, schema]) {
  assert.match(sql, /create table if not exists public\.storage_consistency_issues/)
  assert.match(sql, /storage_provider in \('supabase', 'r2'\)/)
  assert.match(sql, /idx_storage_consistency_open_object/)
  assert.match(sql, /idx_storage_assets_cleanup_expiry/)
  assert.match(sql, /create or replace function public\.cleanup_storage_consistency_issues/)
  assert.match(sql, /revoke all on table public\.storage_consistency_issues/)
  assert.match(sql, /to service_role/)
}

assert.doesNotMatch(consistencyMigration, /\bdelete\s+from\s+public\.photos\b/i)
assert.doesNotMatch(consistencyMigration, /\bdrop\s+table\b/i)

for (const sql of [photoCopyMigration, schema]) {
  assert.match(sql, /migration_attempts/)
  assert.match(sql, /migration_error/)
  assert.match(sql, /migration_started_at/)
  assert.match(sql, /migration_completed_at/)
  assert.match(sql, /idx_photos_storage_migration_recovery/)
  assert.match(sql, /create or replace function public\.claim_photo_storage_migrations/)
  assert.match(sql, /for update skip locked/)
  assert.match(sql, /migration_status = 'copying'/)
  assert.match(sql, /migration_attempts = coalesce\(p\.migration_attempts, 0\) \+ 1/)
  assert.match(sql, /not exists \([\s\S]*from public\.photo_jobs/)
  assert.match(sql, /pj\.status in \('pending', 'processing'\)/)
  assert.match(sql, /revoke all on function public\.claim_photo_storage_migrations/)
  assert.match(sql, /to service_role/)
}

assert.doesNotMatch(photoCopyMigration, /\bdelete\s+from\b/i)
assert.doesNotMatch(photoCopyMigration, /\bdrop\s+(table|column)\b/i)

for (const sql of [sourceCleanupMigration, schema]) {
  assert.match(sql, /source_cleanup_status/)
  assert.match(sql, /source_cleanup_after/)
  assert.match(sql, /source_cleanup_attempts/)
  assert.match(sql, /source_cleanup_error/)
  assert.match(sql, /source_cleanup_started_at/)
  assert.match(sql, /source_cleanup_completed_at/)
  assert.match(sql, /idx_photos_source_cleanup_claim/)
  assert.match(sql, /create or replace function public\.schedule_photo_source_cleanup/)
  assert.match(sql, /interval '30 days'/)
  assert.match(sql, /create or replace function public\.claim_photo_source_cleanups/)
  assert.match(sql, /for update skip locked/)
  assert.match(sql, /coalesce\(p\.migration_attempts, 0\) > 0/)
  assert.match(sql, /not exists \([\s\S]*from public\.photo_jobs/)
  assert.match(sql, /p\.source_cleanup_after <= now\(\)/)
  assert.match(sql, /p_minimum_age_days/)
  assert.match(sql, /revoke all on function public\.claim_photo_source_cleanups/)
  assert.match(sql, /to service_role/)
}

assert.doesNotMatch(sourceCleanupMigration, /\bdelete\s+from\b/i)
assert.doesNotMatch(sourceCleanupMigration, /\bdrop\s+(table|column)\b/i)

for (const sql of [
  uploadSessionMigration,
  cameraStorageMigration,
  schema,
]) {
  assert.match(sql, /position\('%2e' in lower\(p_preset_path\)\) > 0/)
  assert.match(sql, /position\('%2f' in lower\(p_preset_path\)\) > 0/)
  assert.match(sql, /position\('%5c' in lower\(p_preset_path\)\) > 0/)
  assert.doesNotMatch(sql, /lower\(p_preset_path\) like '%(?:2e|2f|5c)%'/)
}

assert.match(presetPathValidationMigration, /pg_get_functiondef/)
assert.match(presetPathValidationMigration, /public\.reserve_photo_upload/)
assert.match(presetPathValidationMigration, /public\.reserve_camera_photo_upload/)
assert.match(
  presetPathValidationMigration,
  /'position\(''%2e'' in lower\(p_preset_path\)\) > 0'/
)
assert.match(
  presetPathValidationMigration,
  /'position\(''%2f'' in lower\(p_preset_path\)\) > 0'/
)
assert.match(
  presetPathValidationMigration,
  /'position\(''%5c'' in lower\(p_preset_path\)\) > 0'/
)
assert.doesNotMatch(presetPathValidationMigration, /\bdrop\s+(table|column)\b/i)
assert.doesNotMatch(presetPathValidationMigration, /\bdelete\s+from\b/i)

for (const sql of [cameraImportUniqueMigration, schema]) {
  assert.match(
    sql,
    /drop constraint if exists camera_live_imports_session_file_uidx/
  )
  assert.match(
    sql,
    /drop index if exists public\.camera_live_imports_session_file_uidx/
  )
  assert.match(
    sql,
    /drop index if exists public\.idx_camera_live_imports_unique_file/
  )
  assert.match(
    sql,
    /create unique index if not exists idx_camera_live_imports_unique_filename[\s\S]*album_id, filename/
  )
}

assert.doesNotMatch(cameraImportUniqueMigration, /\bdelete\s+from\b/i)
assert.doesNotMatch(cameraImportUniqueMigration, /\bdrop\s+(table|column)\b/i)

for (const sql of [photoSizeQuotaMigration, schema]) {
  assert.match(
    sql,
    /create or replace function public\.update_storage_after_photo_size_update\(\)/
  )
  assert.match(
    sql,
    /diff := coalesce\(new\.file_size_bytes, 0\) - coalesce\(old\.file_size_bytes, 0\)/
  )
  assert.match(
    sql,
    /create trigger trg_photo_size_update_storage[\s\S]*after update of file_size_bytes on public\.photos/
  )
}

assert.doesNotMatch(photoSizeQuotaMigration, /\bdelete\s+from\b/i)
assert.doesNotMatch(photoSizeQuotaMigration, /\bdrop\s+(table|column)\b/i)

console.log('Storage schema migration contract checks passed')
