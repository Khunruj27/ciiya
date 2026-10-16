import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import {
  applyXmpAdjustments,
  parseXmpPreset,
  presetOperations,
  readXmpNumber,
  relativeTemperature,
} from '../src/lib/xmp-preset'

// Synthetic presets in the two shapes seen in production (no customer files).
const elementPreset = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description rdf:about=""
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" crs:PresetType="Normal">
    <crs:Exposure2012>0.15</crs:Exposure2012>
    <crs:Temperature>5500</crs:Temperature>
    <crs:Highlights2012>-45</crs:Highlights2012>
    <crs:Shadows2012>50</crs:Shadows2012>
    <crs:RedPrimarySaturation>-6</crs:RedPrimarySaturation>
  </rdf:Description></rdf:RDF></x:xmpmeta>`

// Decoys first: RedSaturation/ShadowTint precede the real settings.
const attributePreset = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description rdf:about=""
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
    crs:RedSaturation="+10" crs:ShadowTint="-1" crs:SaturationAdjustmentRed="+40"
    crs:Saturation="-17" crs:Vibrance="+4" crs:Contrast2012="-20"
    crs:Highlights2012="-31" crs:Shadows2012="+35" crs:Tint="+3" crs:ConvertToGrayscale="False"/>
  </rdf:RDF></x:xmpmeta>`

test('element-style settings are read (they were all read as 0 before)', () => {
  const preset = parseXmpPreset(elementPreset)
  assert.equal(preset.exposure, 0.15)
  assert.equal(preset.highlights, -45)
  assert.equal(preset.shadows, 50)
})

test('attribute-style settings are read by exact name, never from look-alike keys', () => {
  const preset = parseXmpPreset(attributePreset)
  assert.equal(preset.saturation, -17, 'not crs:RedSaturation or SaturationAdjustmentRed')
  assert.equal(preset.tint, 3, 'not crs:ShadowTint')
  assert.equal(preset.vibrance, 4)
  assert.equal(preset.contrast, -20)
  assert.equal(preset.grayscale, false)
  assert.equal(readXmpNumber(attributePreset, 'Exposure2012'), 0, 'missing settings are neutral')
})

test('Kelvin white balance becomes a bounded shift from daylight; the relative slider is kept', () => {
  assert.equal(relativeTemperature(5500), 0)
  assert.equal(relativeTemperature(6500), 40)
  assert.equal(relativeTemperature(3000), -100)
  assert.equal(relativeTemperature(50000), 100)
  assert.equal(relativeTemperature(25), 25)
  assert.equal(relativeTemperature(-140), -100)
  assert.equal(parseXmpPreset(elementPreset).temperature, 0, '5500 K must not read as +5500 (deep orange)')
})

test('lifted shadows produce a tone exponent below 1, recovered highlights above', () => {
  assert.ok(presetOperations(parseXmpPreset(elementPreset)).toneExponent < 1)
  const highlightsOnly = { ...parseXmpPreset(elementPreset), shadows: 0, highlights: 60 }
  assert.ok(presetOperations(highlightsOnly).toneExponent > 1)
})

async function meanRgb(image: sharp.Sharp) {
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true })
  const sums = [0, 0, 0]
  for (let i = 0; i < data.length; i += info.channels) for (let c = 0; c < 3; c++) sums[c] += data[i + c]
  const n = data.length / info.channels
  return sums.map((v) => v / n)
}

async function gradient() {
  const w = 256, h = 16, raw = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 3
    raw[o] = x; raw[o + 1] = Math.round(x * 0.8 + 20); raw[o + 2] = Math.round(255 - x * 0.7)
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer()
}

test('the element-style preset now visibly brightens the image without a colour cast', async () => {
  const src = await gradient()
  const before = await meanRgb(sharp(src))
  const after = await meanRgb(applyXmpAdjustments(sharp(src), parseXmpPreset(elementPreset)))
  const lift = after.reduce((a, b) => a + b) / 3 - before.reduce((a, b) => a + b) / 3
  assert.ok(lift > 6, `expected a visible lift, got ${lift.toFixed(1)}`)
  const castBefore = before[0] - before[2], castAfter = after[0] - after[2]
  assert.ok(Math.abs(castAfter - castBefore) < 8, 'a 5500 K preset must not push the image orange')
})

test('the attribute-style preset lowers saturation as configured', async () => {
  const src = await gradient()
  const spread = (rgb: number[]) => Math.max(...rgb) - Math.min(...rgb)
  const before = await meanRgb(sharp(src))
  const after = await meanRgb(applyXmpAdjustments(sharp(src), parseXmpPreset(attributePreset)))
  assert.ok(spread(after) < spread(before), 'Saturation -17 should reduce channel spread')
})

test('no preset leaves the image untouched', async () => {
  const src = await gradient()
  assert.deepEqual(await meanRgb(applyXmpAdjustments(sharp(src), null)), await meanRgb(sharp(src)))
})
