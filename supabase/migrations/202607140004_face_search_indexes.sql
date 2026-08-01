-- Face search performance indexes

create index if not exists idx_photo_faces_album_owner
on public.photo_faces(
    album_id,
    owner_id
);

create index if not exists idx_photo_faces_cluster
on public.photo_faces(
    cluster_id
)
where cluster_id is not null;

create index if not exists idx_photo_faces_person_cluster
on public.photo_faces(
    person_cluster_id
)
where person_cluster_id is not null;

create index if not exists idx_photo_faces_photo
on public.photo_faces(
    photo_id
);

create index if not exists idx_photo_faces_album_photo
on public.photo_faces(
    album_id,
    photo_id
);