import type { Album } from './types';

export type AlbumSort = 'newest' | 'name' | 'photos';

function searchText(value: string) {
  // Preserve Thai vowels/tone marks; only normalize equivalent Unicode and spaces.
  return value.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
}

/** Local search never sends album titles, descriptions or queries to a service. */
export function selectAlbums(
  albums: readonly Album[],
  query: string,
  sort: AlbumSort,
  locale: 'th' | 'en'
): Album[] {
  const words = searchText(query).split(' ').filter(Boolean);
  const matches = albums.filter((album) => {
    const text = searchText(`${album.title ?? ''} ${album.description ?? ''}`);
    return words.every((word) => text.includes(word));
  });
  const names = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
  const timestamp = (album: Album) => {
    const value = Date.parse(album.createdAt);
    return Number.isFinite(value) ? value : 0;
  };

  return matches.sort((a, b) => {
    const byDate = timestamp(b) - timestamp(a);
    const byName = names.compare(a.title?.trim() ?? '', b.title?.trim() ?? '');
    const primary = sort === 'name' ? byName : sort === 'photos' ? b.photoCount - a.photoCount : byDate;
    // Stable ordering also when multiple albums share a date, name or count.
    return primary || byDate || names.compare(a.id, b.id);
  });
}
