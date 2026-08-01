create index if not exists idx_worker_logs_worker_type_created
on public.worker_logs(
    worker_type,
    created_at desc
);

create index if not exists idx_worker_logs_photo
on public.worker_logs(photo_id);

create index if not exists idx_worker_logs_job
on public.worker_logs(job_id);

create index if not exists idx_worker_logs_owner
on public.worker_logs(owner_id);

create index if not exists idx_worker_logs_album
on public.worker_logs(album_id);