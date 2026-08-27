'use client'

import { useCallback, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import AlbumsSearch from './albums-search'
import DeleteAlbumButton from './delete-album-button'
import AppIcon from '@/components/app-icon'

type Album = {
  id: string
  title: string | null
  description: string | null
  cover_url: string | null
}

type Props = {
  albums: Album[]
  photoCountMap: Record<string, number>
}

export default function AlbumsListClient({ albums, photoCountMap }: Props) {
  const [visibleIds, setVisibleIds] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [isSearchOpen, setIsSearchOpen] = useState(false)

  const hasSearched = query.trim().length > 0

  const handleSearchChange = useCallback((ids: string[], nextQuery: string) => {
    setVisibleIds(ids)
    setQuery(nextQuery)
  }, [])

  const filteredAlbums = hasSearched
    ? albums.filter((album) => visibleIds.includes(album.id))
    : []

  return (
    <>
      <button
        type="button"
        onClick={() => setIsSearchOpen(true)}
        className="mt-3 flex h-[56px] w-full items-center gap-3 rounded-full border border-line bg-white px-5 text-left"
      >
        <AppIcon name="search" size={22} className="opacity-50" />
        <span className="text-[16px] font-medium text-muted">
          Search jobs
        </span>
      </button>

      {isSearchOpen ? (
        <div className="fixed inset-0 z-[80] bg-black/20 px-5 pt-[max(92px,env(safe-area-inset-top))] backdrop-blur-sm">
          <div className="mx-auto w-full max-w-xl rounded-panel border border-line bg-ground p-4 shadow-lift sm:p-6">
            <div className="flex items-center justify-between">
              <p className="text-[22px] font-semibold tracking-[-0.05em]">
                Search jobs
              </p>

              <button
                type="button"
                onClick={() => {
                  setIsSearchOpen(false)
                  setQuery('')
                  setVisibleIds([])
                }}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[22px] font-bold"
              >
                ×
              </button>
            </div>

            <div className="mt-4">
              <AlbumsSearch albums={albums} onSearchChange={handleSearchChange} />
            </div>

            {hasSearched ? (
              <div className="mt-5 max-h-[58vh] space-y-3 overflow-y-auto pb-2">
                {filteredAlbums.length > 0 ? (
                  filteredAlbums.map((album) => (
                    <div
                      key={album.id}
                      className="relative overflow-hidden rounded-panel border border-line bg-white p-3"
                    >
                      <DeleteAlbumButton albumId={album.id} />

                      <Link
                        href={`/albums/${album.id}`}
                        onClick={() => setIsSearchOpen(false)}
                        className="flex gap-3"
                      >
                        <div className="relative h-[92px] w-[102px] shrink-0 overflow-hidden rounded-panel bg-ground-sunken">
                          {album.cover_url ? (
                            <Image
                              src={album.cover_url}
                              alt={album.title || 'Album'}
                              fill
                              sizes="102px"
                              unoptimized
                              className="object-cover"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center text-xs font-bold text-muted">
                              No cover
                            </div>
                          )}

                          <span className="absolute bottom-2 left-2 rounded-full bg-white/90 px-2 py-1 text-[11px] font-semibold text-ink backdrop-blur-xl">
                            {photoCountMap[album.id] || 0}
                          </span>
                        </div>

                        <div className="min-w-0 flex-1 pr-7">
                          <p className="truncate text-[16px] font-semibold text-ink">
                            {album.title || 'Untitled Album'}
                          </p>

                          <span className="mt-1 inline-block rounded-full bg-gold-soft px-3 py-1 text-[11px] font-semibold text-ink">
                            Album
                          </span>

                          <p className="mt-2 line-clamp-2 text-[13px] font-semibold leading-snug text-muted">
                            {album.description || 'No description yet'}
                          </p>
                        </div>
                      </Link>
                    </div>
                  ))
                ) : (
                  <div className="rounded-panel border border-line bg-white px-6 py-10 text-center">
                    <AppIcon name="gallery" size={42} className="mx-auto opacity-35" />

                    <p className="mt-4 text-[18px] font-semibold text-ink">
                      No matching jobs found
                    </p>

                    <p className="mt-1 text-[13px] font-semibold text-muted">
                      Try another keyword.
                    </p>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  )
}
