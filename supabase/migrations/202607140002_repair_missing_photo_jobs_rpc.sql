-- Atomically recreate missing photo processing jobs.
-- Compatible with the actual V54.1 schema.

create or replace function public.repair_missing_photo_jobs(
  repair_limit integer default 500
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  repaired_count integer := 0;
begin
  if repair_limit is null or repair_limit < 1 or repair_limit > 5000 then
    raise exception 'repair_limit must be between 1 and 5000';
  end if;

  with missing_photos as (
    select
      p.id,
      coalesce(p.owner_id, p.user_id) as effective_owner_id,
      p.album_id,
      coalesce(
        p.original_path,
        p.storage_path
      ) as source_path,
      coalesce(p.selected_size, 'hd') as requested_size,
      p.preset_path,
      p.created_at
    from public.photos p
    where p.processing_status in ('pending', 'failed')
      and coalesce(p.owner_id, p.user_id) is not null
      and p.album_id is not null
      and coalesce(
        p.original_path,
        p.storage_path
      ) is not null
      and not exists (
        select 1
        from public.photo_jobs j
        where j.photo_id = p.id
      )
    order by p.created_at asc
    limit repair_limit
  ),
  inserted_jobs as (
    insert into public.photo_jobs (
      photo_id,
      owner_id,
      album_id,
      original_path,
      preset_path,
      size,
      status,
      priority,
      progress,
      retry_count,
      retries,
      started_at,
      finished_at,
      error,
      worker_id,
      claimed_by,
      payload,
      created_at,
      updated_at
    )
    select
      p.id,
      p.effective_owner_id,
      p.album_id,
      p.source_path,
      p.preset_path,
      p.requested_size,
      'pending',
      100,
      0,
      0,
      0,
      null,
      null,
      null,
      null,
      null,
      jsonb_build_object(
        'source',
        'queue-consistency-rpc',
        'photoId',
        p.id,
        'originalPath',
        p.source_path,
        'presetPath',
        p.preset_path
      ),
      now(),
      now()
    from missing_photos p
    on conflict (photo_id) do nothing
    returning id
  )
  select count(*)
  into repaired_count
  from inserted_jobs;

  return repaired_count;
end;
$$;

revoke all
on function public.repair_missing_photo_jobs(integer)
from public;

grant execute
on function public.repair_missing_photo_jobs(integer)
to service_role;