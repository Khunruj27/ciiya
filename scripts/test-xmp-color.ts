import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import {
  applyColorPixels,
  calibrationMatrix,
  curveTable,
  hasColorWork,
  parametricTable,
  rangeWeights,
  readXmpCurve,
  type XmpColorSettings,
} from '../src/lib/xmp-color'
import { needsColorStage, parseXmpPreset, renderPreset } from '../src/lib/xmp-preset'

// Synthetic presets shaped like the Lightroom files seen in production.
const seq = (name: string, points: string[]) =>
  `<crs:${name}><rdf:Seq>${points.map((p) => `<rdf:li>${p}</rdf:li>`).join('')}</rdf:Seq></crs:${name}>`
const filmPreset = `<x:xmpmeta><rdf:Description crs:SaturationAdjustmentGreen="-60" crs:HueAdjustmentOrange="+20"
  crs:SplitToningShadowHue="40" crs:SplitToningShadowSaturation="40" crs:SplitToningHighlightHue="210"
  crs:SplitToningHighlightSaturation="20" crs:ParametricHighlights="-50" crs:RedHue="+13" crs:BlueSaturation="-10">
  ${seq('ToneCurvePV2012', ['0, 30', '128, 128', '255, 235'])}
  ${seq('ToneCurvePV2012Blue', ['0, 0', '255, 255'])}
</rdf:Description></x:xmpmeta>`
const bwPreset = `<x:xmpmeta><rdf:Description crs:ConvertToGrayscale="True" crs:GrayMixerGreen="-60" crs:GrayMixerRed="+40"/></x:xmpmeta>`

const neutral = (): XmpColorSettings => ({
  toneCurve: null, toneCurveRed: null, toneCurveGreen: null, toneCurveBlue: null,
  parametric: { shadows: 0, darks: 0, lights: 0, highlights: 0, split: [25, 50, 75] },
  hue: Array(8).fill(0), saturation: Array(8).fill(0), luminance: Array(8).fill(0), grayMixer: Array(8).fill(0),
  splitToning: { shadowHue: 0, shadowSaturation: 0, highlightHue: 0, highlightSaturation: 0, balance: 0 },
  calibration: { hue: [0, 0, 0], saturation: [0, 0, 0] },
})

test('curves are read from rdf:Seq; identity, malformed or unordered curves are ignored', () => {
  assert.deepEqual(readXmpCurve(filmPreset, 'ToneCurvePV2012'), [[0, 30], [128, 128], [255, 235]])
  assert.equal(readXmpCurve(filmPreset, 'ToneCurvePV2012Blue'), null, 'identity')
  assert.equal(readXmpCurve(filmPreset, 'ToneCurvePV2012Red'), null, 'absent')
  assert.equal(readXmpCurve(seq('ToneCurvePV2012', ['0, 0', 'x, 3']), 'ToneCurvePV2012'), null)
  assert.equal(readXmpCurve(seq('ToneCurvePV2012', ['0, 0']), 'ToneCurvePV2012'), null)
  assert.equal(readXmpCurve(seq('ToneCurvePV2012', ['0, 0', '100, 10', '100, 20', '255, 255']), 'ToneCurvePV2012'), null)
})

test('the point curve passes through its points and stays monotone', () => {
  const table = curveTable([[0, 30], [66, 65], [177, 172], [255, 244]])
  assert.equal(Math.round(table[0]), 30)
  assert.equal(Math.round(table[66]), 65)
  assert.equal(Math.round(table[177]), 172)
  assert.equal(Math.round(table[255]), 244)
  for (let i = 1; i < 256; i++) assert.ok(table[i] >= table[i - 1] - 1e-6, `monotone at ${i}`)
  const identity = curveTable(null)
  for (let i = 0; i < 256; i++) assert.equal(identity[i], i)
})

test('the parametric curve moves only its region, keeps black and white, and stays monotone', () => {
  const lower = parametricTable({ shadows: 0, darks: 0, lights: 0, highlights: -60, split: [25, 50, 75] })
  assert.ok(lower[220] < 215, 'highlights pulled down')
  assert.ok(Math.abs(lower[40] - 40) < 1, 'shadows untouched')
  assert.equal(lower[0], 0)
  assert.ok(Math.abs(lower[255] - 255) < 1)
  for (let i = 1; i < 256; i++) assert.ok(lower[i] >= lower[i - 1])
  const raise = parametricTable({ shadows: 60, darks: 0, lights: 0, highlights: 0, split: [25, 50, 75] })
  assert.ok(raise[30] > 33)
})

test('hue weights split between the two neighbouring colour ranges', () => {
  assert.deepEqual(rangeWeights(0), [0, 1, 0])
  const [a, b, t] = rangeWeights(45)
  assert.deepEqual([a, b], [1, 2])
  assert.ok(Math.abs(t - 0.5) < 1e-9)
  assert.deepEqual(rangeWeights(330).slice(0, 2), [7, 0], 'magenta wraps to red')
  assert.deepEqual(rangeWeights(-30).slice(0, 2), [7, 0])
})

test('calibration keeps neutral gray neutral', () => {
  const m = calibrationMatrix({ hue: [13, 14, -11], saturation: [10, -6, -10] })!
  for (const v of [30, 128, 220]) {
    const out = [0, 1, 2].map((row) => m[row * 3] * v + m[row * 3 + 1] * v + m[row * 3 + 2] * v)
    for (const c of out) assert.ok(Math.abs(c - v) < 1e-6)
  }
  assert.equal(calibrationMatrix({ hue: [0, 0, 0], saturation: [0, 0, 0] }), null)
})

test('HSL saturation and hue act on that colour only; grays are untouched', () => {
  const color = neutral()
  color.saturation[3] = -100 // green
  const pixels = Buffer.from([40, 180, 40, 128, 128, 128, 200, 60, 60])
  applyColorPixels(pixels, 3, color, false)
  const [gr, gg, gb] = pixels.subarray(0, 3)
  assert.ok(Math.abs(gr - gg) < 6 && Math.abs(gg - gb) < 6, 'green desaturated')
  assert.deepEqual([...pixels.subarray(3, 6)], [128, 128, 128], 'gray unchanged')
  assert.deepEqual([...pixels.subarray(6, 9)], [200, 60, 60], 'red unchanged')
})

test('split toning tints shadows and highlights with their hues', () => {
  const color = neutral()
  color.splitToning = { shadowHue: 30, shadowSaturation: 60, highlightHue: 220, highlightSaturation: 60, balance: 0 }
  const pixels = Buffer.from([40, 40, 40, 220, 220, 220])
  applyColorPixels(pixels, 3, color, false)
  assert.ok(pixels[0] > pixels[2], 'warm shadows')
  assert.ok(pixels[5] > pixels[3], 'cool highlights')
})

test('the B&W mixer darkens greens and brightens reds in the gray result', () => {
  const color = neutral()
  color.grayMixer[3] = -60
  color.grayMixer[0] = 40
  const pixels = Buffer.from([60, 160, 60, 160, 60, 60])
  const lumaGreen = 0.299 * 60 + 0.587 * 160 + 0.114 * 60
  const lumaRed = 0.299 * 160 + 0.587 * 60 + 0.114 * 60
  applyColorPixels(pixels, 3, color, true)
  assert.equal(pixels[0], pixels[1])
  assert.equal(pixels[1], pixels[2])
  assert.ok(pixels[0] < lumaGreen - 10)
  assert.ok(pixels[3] > lumaRed + 3)
})

test('the colour stage runs only when a preset needs it', () => {
  const film = parseXmpPreset(filmPreset)
  assert.ok(hasColorWork(film.color, false))
  assert.ok(needsColorStage(film))
  const plain = parseXmpPreset('<x:xmpmeta><rdf:Description crs:Exposure2012="+0.5"/></x:xmpmeta>')
  assert.equal(needsColorStage(plain), false)
  assert.ok(needsColorStage(parseXmpPreset(bwPreset)), 'B&W always uses the mixer stage')
  assert.equal(needsColorStage(null), false)
})

test('renderPreset applies the curve, resizes first, and is identical to before without colour work', async () => {
  const gradient = await sharp(Buffer.from(Array.from({ length: 64 * 16 * 3 }, (_, i) => Math.floor(((i / 3) % 64) * 4))), {
    raw: { width: 64, height: 16, channels: 3 },
  }).png().toBuffer()
  const film = parseXmpPreset(filmPreset)
  const out = await (await renderPreset(sharp(gradient), film, { width: 32 })).raw().toBuffer({ resolveWithObject: true })
  assert.equal(out.info.width, 32)
  assert.ok(out.data[0] >= 20, 'the curve lifts black to a matte floor')

  const plain = parseXmpPreset('<x:xmpmeta><rdf:Description crs:Exposure2012="+0.5"/></x:xmpmeta>')
  const a = await (await renderPreset(sharp(gradient), plain)).raw().toBuffer()
  const { applyXmpAdjustments } = await import('../src/lib/xmp-preset')
  const b = await applyXmpAdjustments(sharp(gradient), plain).raw().toBuffer()
  assert.deepEqual(a, b)

  const bw = await (await renderPreset(sharp(gradient), parseXmpPreset(bwPreset))).raw().toBuffer({ resolveWithObject: true })
  for (let p = 0; p < bw.data.length; p += bw.info.channels) assert.ok(bw.data[p] === bw.data[p + 1] && bw.data[p + 1] === bw.data[p + 2])
})
