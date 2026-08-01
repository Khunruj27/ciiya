-- Storage ownership hardening for the albums bucket.
-- Restricts authenticated client writes to paths beginning with auth.uid().

drop policy if exists "album_storage_auth_upload"
on storage.objects;

drop policy if exists "album_storage_auth_update"
on storage.objects;

drop policy if exists "album_storage_auth_delete"
on storage.objects;

create policy "album_storage_auth_upload"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'albums'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "album_storage_auth_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'albums'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'albums'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "album_storage_auth_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'albums'
  and (storage.foldername(name))[1] = auth.uid()::text
);