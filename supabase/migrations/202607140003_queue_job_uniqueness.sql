-- Prevent duplicate photo/face jobs for the same photo.

create unique index if not exists uq_photo_jobs_photo_id
on public.photo_jobs(photo_id)
where photo_id is not null;

create unique index if not exists uq_face_jobs_photo_id
on public.face_jobs(photo_id)
where photo_id is not null;