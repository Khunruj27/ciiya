-- Ten additional Portfolio compositions. The same saved layout value drives
-- both the editor preview and the public /portfolio/[slug] page.

alter table public.portfolios
  drop constraint if exists portfolios_layout_check;

alter table public.portfolios
  add constraint portfolios_layout_check
  check (
    layout in (
      'editorial', 'grid', 'masonry', 'stack',
      'minimal', 'split', 'classic', 'bold',
      'luxe', 'portrait', 'journal', 'noir',
      'monogram', 'horizon', 'museum', 'polaroid',
      'duotone', 'coverflow', 'mosaic_luxe', 'contact_sheet',
      'letterbox', 'sanctuary'
    )
  );
