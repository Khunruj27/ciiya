'use client'

import { useEffect, useMemo, useState } from 'react'
import AppIcon from '@/components/app-icon'

type Album = {
  id: string
  title: string | null
  description: string | null
}

type Props = {
  albums: Album[]
  onSearchChange: (ids: string[], query: string) => void
}

export default function AlbumsSearch({ albums, onSearchChange }: Props) {
  const [query, setQuery] = useState('')

  const filteredIds = useMemo(() => {
    const keyword = query.trim().toLowerCase()

    if (!keyword) {
      return []
    }

    return albums
      .filter((album) => {
        const text = [album.title, album.description]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()

        return text.includes(keyword)
      })
      .map((album) => album.id)
  }, [albums, query])

  useEffect(() => {
    onSearchChange(filteredIds, query)
  }, [filteredIds, query, onSearchChange])

  return (
  <div className="mt-3">
      <div className="flex h-13 items-center gap-3 rounded-control border border-line bg-surface px-4">
        <AppIcon name="search" size={22} className="opacity-50" />

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ค้นหาจากชื่อหรือคำอธิบาย"
          className="flex-1 bg-transparent text-[16px] font-medium outline-none"
        />

        {query ? (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-gold-soft text-[18px] font-bold"
          >
            ×
          </button>
        ) : null}
      </div>

      {query.trim() ? (
        <p className="mt-3 px-2 text-[13px] font-semibold text-muted">
          พบ {filteredIds.length} งาน
        </p>
      ) : null}
    </div>
  )
}
