'use client'

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { getGalleryWindow } from '@/lib/gallery-window'

type Props = {
  rowCount: number
  rowHeight: number
  columnCount: number
  columnWidth: number
  children: (cell: { rowIndex: number; columnIndex: number; style: CSSProperties }) => ReactNode
}

export default function PageWindowedGrid({ rowCount, rowHeight, columnCount, columnWidth, children }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [range, setRange] = useState({ startRow: 0, endRow: 0 })

  useEffect(() => {
    const node = ref.current
    if (!node) return
    let frame: number | null = null
    function measure() {
      frame = null
      const rect = node!.getBoundingClientRect()
      const next = getGalleryWindow({
        top: rect.top,
        viewportHeight: rect.width > 0 ? window.innerHeight : 0,
        rowHeight, rowCount,
      })
      setRange((current) => current.startRow === next.startRow && current.endRow === next.endRow ? current : next)
    }
    function schedule() {
      if (frame === null) frame = requestAnimationFrame(measure)
    }
    // One measurement per animation frame, even during rapid page scrolling.
    schedule()
    window.addEventListener('scroll', schedule, { passive: true, capture: true })
    window.addEventListener('resize', schedule, { passive: true })
    const observer = new ResizeObserver(schedule)
    observer.observe(node)
    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
    }
  }, [rowCount, rowHeight])

  const cells: ReactNode[] = []
  // Clamp immediately when live photos/density change, before measurement.
  for (let rowIndex = range.startRow; rowIndex < Math.min(range.endRow, rowCount); rowIndex++) {
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
      cells.push(children({ rowIndex, columnIndex, style: {
        position: 'absolute', top: rowIndex * rowHeight,
        left: columnIndex * columnWidth, width: columnWidth, height: rowHeight,
      } }))
    }
  }
  return <div ref={ref} data-page-windowed-grid style={{ position: 'relative', height: rowCount * rowHeight }}>{cells}</div>
}
