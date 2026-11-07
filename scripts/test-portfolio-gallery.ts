import assert from 'node:assert/strict'
import { composePortfolioGallery, PORTFOLIO_GALLERY_COMPOSITIONS, PORTFOLIO_GALLERY_LAYOUTS } from '../src/lib/portfolio-gallery-composition'
import { readFileSync } from 'node:fs'
import { getDictionary, LOCALES } from '../src/lib/i18n'
import type { Portfolio } from '../src/lib/portfolio-types'

const layouts = Object.keys(PORTFOLIO_GALLERY_COMPOSITIONS) as Portfolio['gallery_layout'][]
assert.equal(layouts.length, 10)
assert.deepEqual([...PORTFOLIO_GALLERY_LAYOUTS], layouts, 'the chooser exposes exactly the replacement catalog')
const retiredNames = ['Seamless Swipe', 'Clean Grid', 'Photo Dump', 'Film Roll', 'Hero Canvas', 'Story Flow', 'Panorama Flow', 'Freeform Canvas', 'Layered Cards', 'Print Journal']
for (const locale of LOCALES) {
  const labels = PORTFOLIO_GALLERY_LAYOUTS.map(layout => getDictionary(locale).pe.galleryLayouts[layout].label)
  assert.equal(new Set(labels).size, layouts.length, 'each replacement has a distinct name')
  assert.ok(labels.every(label => !retiredNames.includes(label)), 'no retired names in either language')
}
for (const path of ['src/components/portfolio-editor.tsx', 'src/components/portfolio-gallery.tsx']) {
  const source = readFileSync(path, 'utf8')
  assert.ok(!source.includes('UPDATED_GALLERY_LAYOUTS'), 'no branch back to the retired layouts')
  assert.ok(!source.includes('function MiniPhoto') && !source.includes('const frameClass'), 'retired previews and rendering are removed')
}
for (const layout of layouts) {
  for (let count = 0; count <= 24; count++) {
    const pages = composePortfolioGallery(layout, count)
    assert.deepEqual(pages.flatMap(page => page.indices), Array.from({ length: count }, (_, index) => index), `${layout}: keep every photo once, in order`)
    for (const page of pages) {
      assert.equal(page.indices.length, page.frames.length)
      for (const frame of page.frames) {
        assert.ok(frame.x >= 0 && frame.y >= 0 && frame.width > 0 && frame.height > 0)
        assert.ok(frame.x + frame.width <= 100 && frame.y + frame.height <= 100, `${layout}: frame stays inside portrait page`)
      }
    }
  }
}
assert.equal(new Set(layouts.map(layout => JSON.stringify(PORTFOLIO_GALLERY_COMPOSITIONS[layout]))).size, 10, 'every composition is distinct')
console.log('PASS: 10 vertical compositions, 0–24 photos, complete ordering, unique photos and bounded frames.')
