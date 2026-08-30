-- Let the notification bell update live: add share_events to the realtime
-- publication so owner clients receive inserts/updates for their own rows.
-- RLS on the table still restricts delivery to the owner.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'share_events'
  ) then
    alter publication supabase_realtime add table public.share_events;
  end if;
end $$;
