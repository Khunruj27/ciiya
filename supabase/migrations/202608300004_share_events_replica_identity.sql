-- Realtime delivers DELETE/UPDATE rows with only the primary key unless the
-- table replicates the full old row. The notification bell subscribes with a
-- `owner_id=eq.<id>` filter, so without the full row Postgres can't evaluate
-- the filter on a delete (guest unlikes a photo/moment) or an update (owner
-- marks all read) and drops the event. REPLICA IDENTITY FULL publishes every
-- column so those changes reach the owner's bell live, not only on the poll.
alter table public.share_events replica identity full;
