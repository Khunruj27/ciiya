// The page scrolls naturally; only rows intersecting the viewport (plus a
// small buffer) need DOM nodes. endRow is exclusive.
export function getGalleryWindow({
  top, viewportHeight, rowHeight, rowCount, overscan = 3,
}: {
  top: number
  viewportHeight: number
  rowHeight: number
  rowCount: number
  overscan?: number
}) {
  if (rowHeight <= 0 || rowCount <= 0 || viewportHeight <= 0 ||
      top >= viewportHeight || top + rowCount * rowHeight <= 0) {
    return { startRow: 0, endRow: 0 }
  }
  return {
    startRow: Math.max(0, Math.floor(-top / rowHeight) - overscan),
    endRow: Math.min(rowCount, Math.ceil((viewportHeight - top) / rowHeight) + overscan),
  }
}
