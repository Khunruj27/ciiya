'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

type PhotoItem = {
  id: string
  public_url: string
  filename?: string | null
  position?: number | null
}

type Props = {
  albumId: string
  photos: PhotoItem[]
}

function SortablePhotoCard({ photo }: { photo: PhotoItem }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: photo.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5 ${
        isDragging ? 'opacity-70' : ''
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="block w-full cursor-grab active:cursor-grabbing"
      >
        <img
          src={photo.public_url}
          alt={photo.filename || 'photo'}
          className="aspect-square w-full object-cover"
        />
      </button>

      <div className="flex items-center justify-between px-3 py-2 text-xs text-slate-500">
        <span className="truncate">{photo.filename || 'Photo'}</span>
        <span>↕️</span>
      </div>
    </div>
  )
}

export default function ReorderPhotosBoard({ albumId, photos }: Props) {
  const router = useRouter()
  const [items, setItems] = useState<PhotoItem[]>(photos)
  const [saving, setSaving] = useState(false)

  const sensors = useSensors(useSensor(PointerSensor))

  const itemIds = useMemo(() => items.map((item) => item.id), [items])

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    setItems((prev) => {
      const oldIndex = prev.findIndex((item) => item.id === active.id)
      const newIndex = prev.findIndex((item) => item.id === over.id)
      return arrayMove(prev, oldIndex, newIndex)
    })
  }

  async function handleSaveOrder() {
    try {
      setSaving(true)

      const payload = items.map((item, index) => ({
        id: item.id,
        position: index + 1,
      }))

      const res = await fetch('/api/photos/reorder', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          albumId,
          items: payload,
        }),
      })

      const data = await res.json().catch(() => null)

      if (!res.ok) {
        throw new Error(data?.error || 'Failed to save order')
      }

      router.push(`/albums/${albumId}`)
      router.refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to save order')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-3xl bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Reorder Photos</h2>
            <p className="text-sm text-slate-500">
              Drag photos to arrange them in the order you want
            </p>
          </div>

          <button
            type="button"
            onClick={handleSaveOrder}
            disabled={saving}
            className="rounded-2xl bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Order'}
          </button>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={itemIds} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {items.map((photo) => (
              <SortablePhotoCard key={photo.id} photo={photo} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}