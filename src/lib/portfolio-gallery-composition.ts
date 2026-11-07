import type { Portfolio } from './portfolio-types'

// The replacement catalog uses the persisted keys only for compatibility.
export const PORTFOLIO_GALLERY_LAYOUTS = ['carousel', 'grid', 'masonry', 'filmstrip', 'collage', 'collage_story', 'collage_panorama', 'collage_tiles', 'collage_overlap', 'collage_frames'] as const satisfies readonly Portfolio['gallery_layout'][]

export type GalleryFrame = {
  x: number; y: number; width: number; height: number
  border?: boolean
}
type Panel = { background: 'plain' | 'warm' | 'dark'; frames: GalleryFrame[] }
const frame = (x: number, y: number, width: number, height: number, border = false): GalleryFrame =>
  ({ x, y, width, height, border })
const full: Panel = { background: 'plain', frames: [frame(0, 0, 100, 100)] }
const inset: Panel = { background: 'plain', frames: [frame(12, 10, 76, 80, true)] }
const pair: Panel = { background: 'plain', frames: [frame(7, 22, 42, 56), frame(51, 22, 42, 56)] }
const stacked: Panel = { background: 'plain', frames: [frame(7, 7, 86, 42), frame(7, 51, 86, 42)] }
const trio: Panel = { background: 'plain', frames: [frame(6, 6, 88, 43), frame(6, 51, 43, 43), frame(51, 51, 43, 43)] }
const strips: Panel = { background: 'plain', frames: [frame(0, 0, 100, 32), frame(0, 34, 100, 32), frame(0, 68, 100, 32)] }
const four: Panel = { background: 'plain', frames: [frame(4, 4, 45, 45), frame(51, 4, 45, 45), frame(4, 51, 45, 45), frame(51, 51, 45, 45)] }
const mosaic: Panel = { background: 'plain', frames: Array.from({ length: 9 }, (_, i) => frame((i % 3) * 34, Math.floor(i / 3) * 34, 32, 32)) }
const layered: Panel = { background: 'warm', frames: [frame(5, 6, 62, 68), frame(43, 43, 51, 51, true)] }
const floating: Panel = { background: 'warm', frames: [frame(7, 48, 39, 42), frame(50, 8, 39, 42)] }
const collage: Panel = { background: 'warm', frames: [frame(7, 9, 32, 42), frame(44, 16, 49, 31), frame(8, 58, 46, 31), frame(60, 52, 32, 42)] }
const wide: Panel = { background: 'plain', frames: [frame(0, 23, 100, 54)] }

// Reference strips become pages stacked vertically, never rotated photos.
// Retain persisted keys so existing portfolios need no database migration.
export const PORTFOLIO_GALLERY_COMPOSITIONS: Record<Portfolio['gallery_layout'], readonly Panel[]> = {
  carousel: [full, inset, full, stacked, full],
  grid: [four, inset, pair, four, full],
  masonry: [full, strips, inset, trio, full],
  filmstrip: [full, { background: 'dark', frames: [frame(7, 25, 86, 50)] }, strips, full, inset],
  collage: [full, inset, four, wide, inset, full],
  collage_story: [full, strips, full, collage, full, inset],
  collage_panorama: [wide, inset, pair, wide, stacked, full],
  collage_tiles: [mosaic, inset, full, strips, pair],
  collage_overlap: [full, floating, layered, trio, full],
  collage_frames: [inset, stacked, { background: 'warm', frames: [frame(7, 22, 27, 56, true), frame(36.5, 22, 27, 56, true), frame(66, 22, 27, 56, true)] }, full, trio],
}

export function composePortfolioGallery(layout: Portfolio['gallery_layout'], count: number) {
  const pattern = PORTFOLIO_GALLERY_COMPOSITIONS[layout] || PORTFOLIO_GALLERY_COMPOSITIONS.carousel
  const pages: (Panel & { indices: number[] })[] = []
  let next = 0
  while (next < count) {
    let panel = pattern[pages.length % pattern.length]
    const remaining = count - next
    // Balance incomplete final pages without repeating or losing photos.
    if (remaining < panel.frames.length) panel = remaining === 1 ? inset : remaining === 2 ? pair : remaining === 3 ? trio : { ...panel, frames: panel.frames.slice(0, remaining) }
    const indices = panel.frames.map(() => next++)
    pages.push({ ...panel, indices })
  }
  return pages
}
