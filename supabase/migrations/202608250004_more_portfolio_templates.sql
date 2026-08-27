-- Four additional portfolio templates. The layout value is persisted on the
-- portfolio row so the public page always renders the last saved selection.

alter table public.portfolios
  drop constraint if exists portfolios_layout_check;

alter table public.portfolios
  add constraint portfolios_layout_check
  check (
    layout in (
      'editorial',
      'grid',
      'masonry',
      'stack',
      'minimal',
      'split',
      'classic',
      'bold'
    )
  );
