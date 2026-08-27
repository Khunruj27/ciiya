-- The gallery display is independent from the overall Portfolio template.
-- Reordering continues to use gallery_urls array order.

alter table public.portfolios
  add column if not exists gallery_layout text not null default 'carousel';

alter table public.portfolios
  drop constraint if exists portfolios_gallery_layout_check;

alter table public.portfolios
  add constraint portfolios_gallery_layout_check
  check (gallery_layout in ('carousel', 'grid', 'masonry', 'filmstrip'));
