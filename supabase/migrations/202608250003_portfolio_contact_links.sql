-- Let each photographer publish only the contact channels they want.
-- Existing channels default to visible so this migration never hides a
-- currently published way for a client to reach the owner.

alter table public.portfolios
  add column if not exists contact_facebook text,
  add column if not exists contact_tiktok text,
  add column if not exists contact_website text,
  add column if not exists show_contact_line boolean not null default true,
  add column if not exists show_contact_phone boolean not null default true,
  add column if not exists show_contact_email boolean not null default true,
  add column if not exists show_contact_instagram boolean not null default true,
  add column if not exists show_contact_facebook boolean not null default true,
  add column if not exists show_contact_tiktok boolean not null default true,
  add column if not exists show_contact_website boolean not null default true;
