-- More image-led compositions for the public Portfolio gallery. These values
-- only change presentation; gallery_urls remains the ordered source of truth.

alter table public.portfolios
  drop constraint if exists portfolios_gallery_layout_check;

alter table public.portfolios
  add constraint portfolios_gallery_layout_check
  check (
    gallery_layout in (
      'carousel', 'grid', 'masonry', 'filmstrip',
      'collage', 'collage_story', 'collage_panorama', 'collage_tiles'
    )
  );
