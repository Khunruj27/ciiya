import type { Sharp } from 'sharp'

/**
 * The Lightroom / Camera Raw settings the photo worker reproduces. This is an
 * approximation with general image operations, not Lightroom's renderer; tone
 * curves, HSL, colour grading, grain and lens settings are not applied.
 */
export type XmpAdjustments = {
  exposure: number
  contrast: number
  saturation: number
  vibrance: number
  highlights: number
  shadows: number
  whites: number
  blacks: number
  /** Relative white balance shift, -100 (cooler) to +100 (warmer). */
  temperature: number
  tint: number
  grayscale: boolean
}

function escapeKey(key: string) {
  return key.replace(/[^A-Za-z0-9]/g, '')
}

/**
 * Reads one `crs:` setting. Lightroom writes settings as attributes
 * (`crs:Exposure2012="+0.15"`); presets saved by other tools often use
 * elements (`<crs:Exposure2012>0.15</crs:Exposure2012>`). The `crs:` prefix
 * and a word boundary are required, so `crs:RedSaturation` or `crs:ShadowTint`
 * can never be read as `Saturation` or `Tint`.
 */
export function readXmpSetting(xmp: string, key: string): string | null {
  const name = escapeKey(key)
  const attribute = new RegExp(`(?:^|[\\s<])crs:${name}\\s*=\\s*"([^"]*)"`)
  const element = new RegExp(`<crs:${name}>\\s*([^<]*?)\\s*</crs:${name}>`)
  return xmp.match(attribute)?.[1] ?? xmp.match(element)?.[1] ?? null
}

export function readXmpNumber(xmp: string, key: string): number {
  const raw = readXmpSetting(xmp, key)
  if (raw === null) return 0
  const value = Number(raw.trim())
  return Number.isFinite(value) ? value : 0
}

export function readXmpBoolean(xmp: string, key: string): boolean {
  const raw = readXmpSetting(xmp, key)?.trim().toLowerCase()
  return raw === 'true'
}

/** Below this, Temperature is Lightroom's relative slider; above, it is Kelvin. */
const KELVIN_THRESHOLD = 1000
/** Daylight: a preset that sets 5500 K leaves a daylight photo about neutral. */
const NEUTRAL_KELVIN = 5500
/** 25 K per relative step, so ±2500 K from daylight reaches the slider's ends. */
const KELVIN_PER_STEP = 25

/**
 * Raw-file presets store white balance as absolute Kelvin (for example 5500),
 * JPEG presets as a relative slider (-100..+100). Reading Kelvin as the slider
 * turned photos deep orange, so Kelvin is converted to a shift from daylight.
 */
export function relativeTemperature(value: number): number {
  if (Math.abs(value) < KELVIN_THRESHOLD) return clamp(value, -100, 100)
  return clamp((value - NEUTRAL_KELVIN) / KELVIN_PER_STEP, -100, 100)
}

export function parseXmpPreset(xmp: string): XmpAdjustments {
  return {
    exposure: readXmpNumber(xmp, 'Exposure2012'),
    contrast: readXmpNumber(xmp, 'Contrast2012'),
    saturation: readXmpNumber(xmp, 'Saturation'),
    vibrance: readXmpNumber(xmp, 'Vibrance'),
    highlights: readXmpNumber(xmp, 'Highlights2012'),
    shadows: readXmpNumber(xmp, 'Shadows2012'),
    whites: readXmpNumber(xmp, 'Whites2012'),
    blacks: readXmpNumber(xmp, 'Blacks2012'),
    temperature: relativeTemperature(readXmpNumber(xmp, 'Temperature')),
    tint: clamp(readXmpNumber(xmp, 'Tint'), -150, 150),
    grayscale: readXmpBoolean(xmp, 'ConvertToGrayscale'),
  }
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

/** The operations derived from a preset, kept separate so they can be tested. */
export function presetOperations(preset: XmpAdjustments) {
  const brightness = clamp(
    1 + preset.exposure * 0.2 + preset.whites * 0.0015 - preset.blacks * 0.001,
    0.55,
    1.75
  )
  const saturation = preset.grayscale
    ? 0
    : clamp(
        1 + preset.saturation * 0.006 + preset.vibrance * 0.005 + Math.abs(preset.temperature) * 0.0006,
        0.15,
        2.25
      )
  const contrast = clamp(
    1 + preset.contrast * 0.005 + preset.highlights * 0.001 - preset.shadows * 0.001,
    0.65,
    1.85
  )
  // A tone exponent: below 1 lifts shadows and midtones, above 1 deepens them.
  const toneExponent = clamp(1 - preset.shadows * 0.0015 + preset.highlights * 0.001, 0.75, 1.35)
  const warm = preset.temperature || preset.tint
    ? {
        red: clamp(1 + preset.temperature * 0.0012, 0.85, 1.18),
        green: clamp(1 + preset.tint * 0.001, 0.9, 1.12),
        blue: clamp(1 - preset.temperature * 0.0012, 0.85, 1.18),
      }
    : null
  return { brightness, saturation, contrast, toneExponent, warm }
}

export function applyXmpAdjustments(image: Sharp, preset: XmpAdjustments | null): Sharp {
  if (!preset) return image
  const ops = presetOperations(preset)

  let output = image
    .modulate({ brightness: ops.brightness, saturation: ops.saturation })
    .linear(ops.contrast, 128 - 128 * ops.contrast)

  // sharp's gamma(in, out) changes tones by in/out; gamma(x) alone (in = out)
  // is neutral, which is why a lifted Shadows setting used to have no effect.
  if (ops.toneExponent < 0.999) output = output.gamma(1, 1 / ops.toneExponent)
  else if (ops.toneExponent > 1.001) output = output.gamma(ops.toneExponent, 1)

  if (ops.warm) {
    output = output.recomb([
      [ops.warm.red, 0, 0],
      [0, ops.warm.green, 0],
      [0, 0, ops.warm.blue],
    ])
  }

  return output
}
