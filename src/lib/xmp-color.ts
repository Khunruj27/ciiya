/**
 * The colour side of a Lightroom preset that sharp has no operation for: point
 * and parametric tone curves, per-colour HSL, black & white mix, split toning
 * and camera-calibration primaries. These run on raw RGB pixels after resizing,
 * so their cost scales with the delivered size, not the original. It is an
 * approximation of Lightroom's renderer, tuned to move colours the same way.
 */

export type CurvePoint = [number, number]

/** The eight Lightroom colour ranges, in hue order (degrees). */
export const COLOR_RANGES = ['Red', 'Orange', 'Yellow', 'Green', 'Aqua', 'Blue', 'Purple', 'Magenta'] as const
const RANGE_CENTERS = [0, 30, 60, 120, 180, 240, 270, 300]

export type XmpColorSettings = {
  toneCurve: CurvePoint[] | null
  toneCurveRed: CurvePoint[] | null
  toneCurveGreen: CurvePoint[] | null
  toneCurveBlue: CurvePoint[] | null
  /** ParametricShadows/Darks/Lights/Highlights (-100..100) and the three splits (0..100). */
  parametric: { shadows: number; darks: number; lights: number; highlights: number; split: [number, number, number] }
  hue: number[]
  saturation: number[]
  luminance: number[]
  grayMixer: number[]
  splitToning: { shadowHue: number; shadowSaturation: number; highlightHue: number; highlightSaturation: number; balance: number }
  /** Camera calibration: hue and saturation shift of the red, green and blue primaries. */
  calibration: { hue: [number, number, number]; saturation: [number, number, number] }
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function escapeKey(key: string) {
  return key.replace(/[^A-Za-z0-9]/g, '')
}

/** Reads `<crs:Key><rdf:Seq><rdf:li>x, y</rdf:li>…</rdf:Seq></crs:Key>`. */
export function readXmpCurve(xmp: string, key: string): CurvePoint[] | null {
  const name = escapeKey(key)
  const block = xmp.match(new RegExp(`<crs:${name}>\\s*<rdf:Seq>([\\s\\S]*?)</rdf:Seq>\\s*</crs:${name}>`))
  if (!block) return null
  const points: CurvePoint[] = []
  for (const item of block[1].matchAll(/<rdf:li>\s*([-\d.]+)\s*,\s*([-\d.]+)\s*<\/rdf:li>/g)) {
    const x = Number(item[1])
    const y = Number(item[2])
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    points.push([clamp(x, 0, 255), clamp(y, 0, 255)])
  }
  if (points.length < 2 || points.length > 32) return null
  points.sort((a, b) => a[0] - b[0])
  for (let i = 1; i < points.length; i++) if (points[i][0] <= points[i - 1][0]) return null
  return isIdentityCurve(points) ? null : points
}

function isIdentityCurve(points: CurvePoint[]) {
  return points.every(([x, y]) => Math.abs(x - y) < 0.5) &&
    points[0][0] === 0 && points[points.length - 1][0] === 255
}

/** Settings read with the caller's attribute/element reader. */
export function parseXmpColor(xmp: string, readNumber: (key: string) => number): XmpColorSettings {
  const either = (current: string, legacy: string) => readNumber(current) || readNumber(legacy)
  return {
    toneCurve: readXmpCurve(xmp, 'ToneCurvePV2012'),
    toneCurveRed: readXmpCurve(xmp, 'ToneCurvePV2012Red'),
    toneCurveGreen: readXmpCurve(xmp, 'ToneCurvePV2012Green'),
    toneCurveBlue: readXmpCurve(xmp, 'ToneCurvePV2012Blue'),
    parametric: {
      shadows: clamp(readNumber('ParametricShadows'), -100, 100),
      darks: clamp(readNumber('ParametricDarks'), -100, 100),
      lights: clamp(readNumber('ParametricLights'), -100, 100),
      highlights: clamp(readNumber('ParametricHighlights'), -100, 100),
      split: [
        clamp(readNumber('ParametricShadowSplit') || 25, 5, 95),
        clamp(readNumber('ParametricMidtoneSplit') || 50, 5, 95),
        clamp(readNumber('ParametricHighlightSplit') || 75, 5, 95),
      ],
    },
    hue: COLOR_RANGES.map((range) => clamp(readNumber(`HueAdjustment${range}`), -100, 100)),
    saturation: COLOR_RANGES.map((range) => clamp(readNumber(`SaturationAdjustment${range}`), -100, 100)),
    luminance: COLOR_RANGES.map((range) => clamp(readNumber(`LuminanceAdjustment${range}`), -100, 100)),
    grayMixer: COLOR_RANGES.map((range) => clamp(readNumber(`GrayMixer${range}`), -100, 100)),
    splitToning: {
      shadowHue: clamp(readNumber('SplitToningShadowHue'), 0, 360),
      shadowSaturation: clamp(readNumber('SplitToningShadowSaturation'), 0, 100),
      highlightHue: clamp(readNumber('SplitToningHighlightHue'), 0, 360),
      highlightSaturation: clamp(readNumber('SplitToningHighlightSaturation'), 0, 100),
      balance: clamp(readNumber('SplitToningBalance'), -100, 100),
    },
    calibration: {
      hue: [
        clamp(either('RedPrimaryHue', 'RedHue'), -100, 100),
        clamp(either('GreenPrimaryHue', 'GreenHue'), -100, 100),
        clamp(either('BluePrimaryHue', 'BlueHue'), -100, 100),
      ],
      saturation: [
        clamp(either('RedPrimarySaturation', 'RedSaturation'), -100, 100),
        clamp(either('GreenPrimarySaturation', 'GreenSaturation'), -100, 100),
        clamp(either('BluePrimarySaturation', 'BlueSaturation'), -100, 100),
      ],
    },
  }
}

const anyNonZero = (values: number[]) => values.some((value) => value !== 0)

/** True when the pixel stage would change anything (grayscale is decided by the caller). */
export function hasColorWork(color: XmpColorSettings | null | undefined, grayscale: boolean) {
  if (!color) return false
  const p = color.parametric
  const s = color.splitToning
  return Boolean(
    color.toneCurve || color.toneCurveRed || color.toneCurveGreen || color.toneCurveBlue ||
    p.shadows || p.darks || p.lights || p.highlights ||
    anyNonZero(color.hue) || anyNonZero(color.saturation) || anyNonZero(color.luminance) ||
    (grayscale && anyNonZero(color.grayMixer)) ||
    s.shadowSaturation || s.highlightSaturation ||
    anyNonZero(color.calibration.hue) || anyNonZero(color.calibration.saturation)
  )
}

/** Monotone cubic (Fritsch–Carlson) through the curve points, sampled at 256 inputs. */
export function curveTable(points: CurvePoint[] | null): Float32Array {
  const table = new Float32Array(256)
  if (!points) {
    for (let i = 0; i < 256; i++) table[i] = i
    return table
  }
  const n = points.length
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  const delta: number[] = []
  for (let i = 0; i < n - 1; i++) delta.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]))
  const m: number[] = new Array(n)
  m[0] = delta[0]
  m[n - 1] = delta[n - 2]
  for (let i = 1; i < n - 1; i++) m[i] = delta[i - 1] * delta[i] <= 0 ? 0 : (delta[i - 1] + delta[i]) / 2
  for (let i = 0; i < n - 1; i++) {
    if (delta[i] === 0) {
      m[i] = 0
      m[i + 1] = 0
      continue
    }
    const a = m[i] / delta[i]
    const b = m[i + 1] / delta[i]
    const h = a * a + b * b
    if (h > 9) {
      const t = 3 / Math.sqrt(h)
      m[i] = t * a * delta[i]
      m[i + 1] = t * b * delta[i]
    }
  }
  let segment = 0
  for (let x = 0; x < 256; x++) {
    if (x <= xs[0]) {
      table[x] = ys[0]
      continue
    }
    if (x >= xs[n - 1]) {
      table[x] = ys[n - 1]
      continue
    }
    while (x > xs[segment + 1]) segment++
    const h = xs[segment + 1] - xs[segment]
    const t = (x - xs[segment]) / h
    const t2 = t * t
    const t3 = t2 * t
    table[x] = clamp(
      (2 * t3 - 3 * t2 + 1) * ys[segment] + (t3 - 2 * t2 + t) * h * m[segment] +
      (-2 * t3 + 3 * t2) * ys[segment + 1] + (t3 - t2) * h * m[segment + 1],
      0,
      255
    )
  }
  return table
}

/**
 * Lightroom's region curve: each slider raises or lowers one tonal region
 * (bounded by the three splits) with a smooth bump; black and white stay put.
 */
export function parametricTable(p: XmpColorSettings['parametric']): Float32Array {
  const table = new Float32Array(256)
  const [s1, s2, s3] = p.split.map((v) => v / 100)
  const regions: [number, number, number][] = [
    [0, s1, p.shadows],
    [s1, s2, p.darks],
    [s2, s3, p.lights],
    [s3, 1, p.highlights],
  ]
  let previous = 0
  for (let i = 0; i < 256; i++) {
    const x = i / 255
    let offset = 0
    for (const [start, end, amount] of regions) {
      if (!amount) continue
      // A raised-cosine window over the region, widened into its neighbours.
      const center = (start + end) / 2
      const half = (end - start) / 2 + 0.12
      const d = Math.abs(x - center) / half
      if (d < 1) offset += (amount / 100) * 0.16 * 0.5 * (1 + Math.cos(Math.PI * d))
    }
    // Keep the ends fixed and the curve monotone.
    const fade = Math.min(1, x / 0.04, (1 - x) / 0.04)
    const y = clamp(x + offset * fade, 0, 1) * 255
    previous = i === 0 ? y : Math.max(previous, y)
    table[i] = previous
  }
  return table
}

/** Rotation of RGB around the gray axis, used for calibration primaries. */
function rotateAroundGray(rgb: [number, number, number], degrees: number): [number, number, number] {
  const theta = (degrees * Math.PI) / 180
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  const k = 1 / Math.sqrt(3)
  const [x, y, z] = rgb
  const dot = (x + y + z) * k
  // Rodrigues' rotation about the unit vector (k, k, k).
  const cross: [number, number, number] = [k * (z - y), k * (x - z), k * (y - x)]
  return [
    x * cos + cross[0] * sin + k * dot * (1 - cos),
    y * cos + cross[1] * sin + k * dot * (1 - cos),
    z * cos + cross[2] * sin + k * dot * (1 - cos),
  ]
}

/**
 * A 3x3 matrix moving each primary's hue (±100 → ±30°) and saturation, then
 * normalised so neutral grays stay neutral.
 */
export function calibrationMatrix(c: XmpColorSettings['calibration']): number[] | null {
  if (!anyNonZero(c.hue) && !anyNonZero(c.saturation)) return null
  const columns: [number, number, number][] = []
  for (let i = 0; i < 3; i++) {
    const primary: [number, number, number] = [0, 0, 0]
    primary[i] = 1
    const third = 1 / 3
    const chroma: [number, number, number] = [primary[0] - third, primary[1] - third, primary[2] - third]
    const rotated = rotateAroundGray(chroma, c.hue[i] * 0.3)
    const scale = 1 + c.saturation[i] / 200
    columns.push([third + rotated[0] * scale, third + rotated[1] * scale, third + rotated[2] * scale])
  }
  const matrix = [0, 1, 2].map((row) => columns.map((column) => column[row]))
  for (const row of matrix) {
    const sum = row[0] + row[1] + row[2]
    for (let j = 0; j < 3; j++) row[j] /= sum
  }
  return matrix.flat()
}

/** Weights of the two colour ranges around a hue (degrees), summing to 1. */
export function rangeWeights(hue: number): [number, number, number] {
  const h = ((hue % 360) + 360) % 360
  for (let i = 0; i < RANGE_CENTERS.length; i++) {
    const start = RANGE_CENTERS[i]
    const end = i === RANGE_CENTERS.length - 1 ? 360 : RANGE_CENTERS[i + 1]
    if (h >= start && h < end) {
      const t = (h - start) / (end - start)
      return [i, (i + 1) % RANGE_CENTERS.length, t]
    }
  }
  return [0, 1, 0]
}

function hslTint(hue: number): [number, number, number] {
  // Fully saturated colour at that hue, offset from its own gray.
  const h = (((hue % 360) + 360) % 360) / 60
  const x = 1 - Math.abs((h % 2) - 1)
  const [r, g, b] = h < 1 ? [1, x, 0] : h < 2 ? [x, 1, 0] : h < 3 ? [0, 1, x] : h < 4 ? [0, x, 1] : h < 5 ? [x, 0, 1] : [1, 0, x]
  const gray = 0.299 * r + 0.587 * g + 0.114 * b
  return [r - gray, g - gray, b - gray]
}

/**
 * Applies the colour stage in place to 8-bit RGB(A) pixels. Order follows
 * Lightroom: calibration, tone curves, HSL or B&W mix, split toning.
 */
export function applyColorPixels(
  data: Uint8Array | Buffer,
  channels: number,
  color: XmpColorSettings,
  grayscale: boolean
) {
  const matrix = calibrationMatrix(color.calibration)
  const parametric = parametricTable(color.parametric)
  const master = curveTable(color.toneCurve)
  const perChannel = [curveTable(color.toneCurveRed), curveTable(color.toneCurveGreen), curveTable(color.toneCurveBlue)]
  // One table per channel: parametric, then the point curve, then that channel's curve.
  const tables = perChannel.map((channel) => {
    const table = new Float32Array(256)
    const at = (t: Float32Array, v: number) => {
      const i = Math.floor(v)
      const f = v - i
      return i >= 255 ? t[255] : t[i] + (t[i + 1] - t[i]) * f
    }
    for (let i = 0; i < 256; i++) table[i] = at(channel, at(master, parametric[i]))
    return table
  })

  const hslActive = !grayscale && (anyNonZero(color.hue) || anyNonZero(color.saturation) || anyNonZero(color.luminance))
  const mixActive = grayscale
  const split = color.splitToning
  const splitActive = split.shadowSaturation > 0 || split.highlightSaturation > 0
  const shadowTint = hslTint(split.shadowHue).map((v) => v * (split.shadowSaturation / 100) * 0.45)
  const highlightTint = hslTint(split.highlightHue).map((v) => v * (split.highlightSaturation / 100) * 0.45)
  const pivot = clamp(0.5 + split.balance / 200, 0.1, 0.9)

  const lerp = (t: Float32Array, v: number) => {
    const i = v | 0
    return i >= 255 ? t[255] : t[i] + (t[i + 1] - t[i]) * (v - i)
  }

  for (let p = 0; p < data.length; p += channels) {
    let r = data[p]
    let g = data[p + 1]
    let b = data[p + 2]

    if (matrix) {
      const nr = matrix[0] * r + matrix[1] * g + matrix[2] * b
      const ng = matrix[3] * r + matrix[4] * g + matrix[5] * b
      const nb = matrix[6] * r + matrix[7] * g + matrix[8] * b
      r = clamp(nr, 0, 255)
      g = clamp(ng, 0, 255)
      b = clamp(nb, 0, 255)
    }

    r = lerp(tables[0], r)
    g = lerp(tables[1], g)
    b = lerp(tables[2], b)

    if (hslActive || mixActive) {
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const chroma = max - min
      const sat = max === 0 ? 0 : chroma / max
      let hue = 0
      if (chroma > 0) {
        if (max === r) hue = 60 * (((g - b) / chroma + 6) % 6)
        else if (max === g) hue = 60 * ((b - r) / chroma + 2)
        else hue = 60 * ((r - g) / chroma + 4)
      }
      const [a, c, t] = rangeWeights(hue)
      const luma = 0.299 * r + 0.587 * g + 0.114 * b

      if (mixActive) {
        // Each range's mixer value brightens or darkens that colour's gray.
        const mix = (color.grayMixer[a] * (1 - t) + color.grayMixer[c] * t) / 100
        const gray = clamp(luma * (1 + mix * sat * 0.6), 0, 255)
        r = g = b = gray
      } else if (chroma > 0) {
        const hueShift = (color.hue[a] * (1 - t) + color.hue[c] * t) * 0.3
        const satScale = 1 + (color.saturation[a] * (1 - t) + color.saturation[c] * t) / 100
        const lumShift = ((color.luminance[a] * (1 - t) + color.luminance[c] * t) / 100) * sat * 0.35
        let cr = r - luma
        let cg = g - luma
        let cb = b - luma
        if (hueShift) [cr, cg, cb] = rotateAroundGray([cr, cg, cb], hueShift)
        const scale = Math.max(0, satScale)
        const newLuma = clamp(luma * (1 + lumShift), 0, 255)
        r = clamp(newLuma + cr * scale, 0, 255)
        g = clamp(newLuma + cg * scale, 0, 255)
        b = clamp(newLuma + cb * scale, 0, 255)
      }
    }

    if (splitActive) {
      const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255
      const shadow = l < pivot ? (pivot - l) / pivot : 0
      const highlight = l > pivot ? (l - pivot) / (1 - pivot) : 0
      r = clamp(r + 255 * (shadowTint[0] * shadow + highlightTint[0] * highlight), 0, 255)
      g = clamp(g + 255 * (shadowTint[1] * shadow + highlightTint[1] * highlight), 0, 255)
      b = clamp(b + 255 * (shadowTint[2] * shadow + highlightTint[2] * highlight), 0, 255)
    }

    data[p] = Math.round(r)
    data[p + 1] = Math.round(g)
    data[p + 2] = Math.round(b)
  }
}
