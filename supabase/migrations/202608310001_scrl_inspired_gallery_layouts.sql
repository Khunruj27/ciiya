-- Mobile-first gallery compositions inspired by seamless canvas workflows.
-- Existing values remain valid; two new layouts add layered and print-journal
-- presentations without changing photo ordering or viewer behaviour.

alter table public.portfolios
  drop constraint if exists portfolios_gallery_layout_check;

alter table public.portfolios
  add constraint portfolios_gallery_layout_check
  check (
    gallery_layout in (
      'carousel', 'grid', 'masonry', 'filmstrip',
      'collage', 'collage_story', 'collage_panorama', 'collage_tiles',
      'collage_overlap', 'collage_frames'
    )
  );
