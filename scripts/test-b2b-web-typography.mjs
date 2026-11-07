import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'

// Validate with the same font parser used by next/font/local at build time.
const require = createRequire(import.meta.url)
const fontkit = require('next/dist/compiled/@next/font/dist/fontkit').default
const fontFromBuffer = fontkit.default || fontkit
const source = (name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8')
test('website uses B2B for Thai and digits before unchanged Latin fallbacks', async () => {
  const layout = await source('src/app/layout.tsx')
  assert.match(layout, /variable: "--font-b2b-hybrid-text"/)
  assert.match(layout, /adjustFontFallback: false/)
  assert.match(layout, /prop: "unicode-range", value: "U\+0030-0039, U\+0E00-0E7F"/)
  for (const name of ['Light', 'Regular', 'Medium', 'SemiBold', 'Bold']) {
    assert.ok(layout.includes(`B2BHybridText-${name}.woff2`))
  }
  for (const file of ['src/app/globals.css', 'src/components/portfolio-first-five.module.css']) {
    const css = await source(file)
    assert.match(css, /var\(--font-b2b-hybrid-text\), var\(--font-manrope\)/)
    assert.doesNotMatch(css, /FCMittraphap|font-fc-mittraphap/)
  }
  assert.doesNotMatch(layout, /FCMittraphap|fcMittraphap/)
  assert.doesNotMatch(await source('src/app/connect/ciiya-sync/page.tsx'), /font-fc-mittraphap/)
})

for (const [name, weight] of Object.entries({Thin:100,ExtraLight:200,Light:300,Regular:400,Medium:500,SemiBold:600,Bold:700,ExtraBold:800,Black:900})) {
  test(`B2B Hybrid Text ${name} has the expected weight, Thai shaping tables and all digits`, async () => {
    const data = await readFile(new URL(`../src/app/fonts/b2b-hybrid/B2BHybridText-${name}.woff2`, import.meta.url))
    assert.equal(data.subarray(0, 4).toString(), 'wOF2')
    const font = fontFromBuffer(data)
    assert.equal(font.familyName, 'B2B Hybrid Text')
    assert.equal(font['OS/2'].usWeightClass, weight)
    assert.ok(font.GSUB && font.GPOS)
    for (const code of [...Array.from({length:10},(_,i)=>48+i), ...Array.from({length:91},(_,i)=>0xe01+i)]) {
      if (code > 0xe3a && code < 0xe3f) continue
      assert.ok(font.hasGlyphForCodePoint(code), `${name}: missing U+${code.toString(16)}`)
    }
  })
}

test('B2B attribution accompanies the bundled font', async () => {
  assert.match(await source('src/app/fonts/b2b-hybrid/B2B-Hybrid-OFL.txt'), /SIL OPEN FONT LICENSE Version 1\.1/)
  assert.match(await source('src/app/fonts/b2b-hybrid/B2B-Hybrid-SOURCES.md'), /Noto Sans Thai/)
  for (const name of ['B2B-Hybrid-OFL.txt','B2B-Hybrid-SOURCES.md']) assert.equal(await source('public/fonts/b2b-hybrid/'+name), await source('src/app/fonts/b2b-hybrid/'+name))
})
