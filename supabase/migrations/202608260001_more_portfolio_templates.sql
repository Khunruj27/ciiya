-- Four additional public Portfolio compositions. A saved template remains the
-- single source of truth for both the editor preview and the public page.

alter table public.portfolios
  drop constraint if exists portfolios_layout_check;

alter table public.portfolios
  add constraint portfolios_layout_check
  check (
    layout in (
      'editorial', 'grid', 'masonry', 'stack',
      'minimal', 'split', 'classic', 'bold',
      'luxe', 'portrait', 'journal', 'noir'
    )
  );
