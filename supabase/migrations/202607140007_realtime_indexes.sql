-- Realtime / dashboard indexes.
-- Compatible with the actual Ciiya V54.1 schema.

create index if not exists idx_photos_processing_status_updated
on public.photos (
  processing_status,
  updated_at desc
);

create index if not exists idx_photo_jobs_status_updated
on public.photo_jobs (
  status,
  updated_at desc
);

create index if not exists idx_face_jobs_status_updated
on public.face_jobs (
  status,
  updated_at desc
);

create index if not exists idx_worker_heartbeats_status_seen
on public.worker_heartbeats (
  status,
  last_seen desc
);

create index if not exists idx_worker_metrics_recorded
on public.worker_metrics (
  recorded_at desc
);