-- Portfolios grow two ways here.
--
-- 1. A custom gallery: images the owner uploads straight to the portfolio,
--    with no album behind them. Until now the only photographs a portfolio
--    could show came from public albums; this lets a page stand on hand-
--    picked images instead.
--
-- 2. Two more page layouts. The check constraint listed only editorial and
--    grid, so it has to be widened before the new values can be stored.

alter table public.portfolios
  add column if not exists gallery_urls text[] not null default '{}';

-- Cap the array so a runaway client can't write an unbounded row. Twenty-four
-- is well past what any portfolio strip shows.
alter table public.portfolios
  drop constraint if exists portfolios_gallery_len;
alter table public.portfolios
  add constraint portfolios_gallery_len
  check (array_length(gallery_urls, 1) is null or array_length(gallery_urls, 1) <= 24);

alter table public.portfolios
  drop constraint if exists portfolios_layout_check;
alter table public.portfolios
  add constraint portfolios_layout_check
  check (layout in ('editorial', 'grid', 'masonry', 'stack'));
