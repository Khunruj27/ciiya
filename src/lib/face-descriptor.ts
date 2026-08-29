/*
 * Turns a selfie a guest uploads into the single 128-d face descriptor used to
 * search an album. Accuracy of the whole feature rests on this one vector, so
 * the extraction is deliberately careful:
 *
 *   1. SSD MobileNet v1 does the detection, not the tiny detector. It finds
 *      faces far more reliably on off-angle or unevenly lit selfies, and the
 *      tighter box it returns feeds the landmark step a cleaner crop — which
 *      is what the recognizer actually turns into the descriptor.
 *   2. When a selfie has more than one face, the largest one is the guest.
 *      Taking "the first detection" (as the old code did) could lock onto a
 *      bystander in the background.
 *   3. A face that is too small or too weakly detected is rejected with a
 *      clear message instead of producing a noisy descriptor that quietly
 *      matches the wrong people.
 *
 * The recognizer is alignment-normalized, so descriptors produced here stay
 * comparable to gallery descriptors even if those were indexed with a
 * different detector.
 */

type FaceApiModule = typeof import('@vladmandic/face-api')

let faceapi: FaceApiModule | null = null
let modelsPromise: Promise<void> | null = null

// Long-edge the selfie is scaled to before detection. Large enough for a
// strong crop, small enough that SSD MobileNet stays quick on a phone; a
// selfie's face fills enough of the frame that this never starves it.
const DETECT_MAX_EDGE = 1280

// Minimum face box side, in pixels of the scaled image. Below this the face is
// too low-resolution to recognize dependably — the guest is too far away.
const MIN_FACE_PX = 96

// SSD scores are calibrated; below this a "face" is most likely a false hit.
const MIN_DETECTION_SCORE = 0.55

export type SelfieDescriptor = {
  descriptor: number[]
  /** How many faces were seen in the selfie (1 is ideal). */
  faceCount: number
  previewUrl: string
}

/** Thrown when the selfie itself is the problem, with a guest-facing message. */
export class SelfieQualityError extends Error {}

async function ensureModels(): Promise<FaceApiModule> {
  if (!faceapi) faceapi = await import('@vladmandic/face-api')

  if (!modelsPromise) {
    modelsPromise = (async () => {
      await faceapi!.nets.ssdMobilenetv1.loadFromUri('/models')
      await faceapi!.nets.faceLandmark68Net.loadFromUri('/models')
      await faceapi!.nets.faceRecognitionNet.loadFromUri('/models')
    })()
  }

  await modelsPromise
  return faceapi!
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Couldn’t load the photo'))
    img.src = src
  })
}

async function normalize(
  file: File
): Promise<{ img: HTMLImageElement; previewUrl: string }> {
  const url = URL.createObjectURL(file)
  let source: HTMLImageElement
  try {
    source = await loadImage(url)
  } finally {
    URL.revokeObjectURL(url)
  }

  const scale = Math.min(
    1,
    DETECT_MAX_EDGE / Math.max(source.naturalWidth, source.naturalHeight)
  )

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(source.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(source.naturalHeight * scale))

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)

  const previewUrl = canvas.toDataURL('image/jpeg', 0.9)
  const img = await loadImage(previewUrl)
  return { img, previewUrl }
}

export async function extractSelfieDescriptor(
  file: File
): Promise<SelfieDescriptor> {
  const api = await ensureModels()
  const { img, previewUrl } = await normalize(file)

  const detections = await api
    .detectAllFaces(
      img,
      new api.SsdMobilenetv1Options({ minConfidence: 0.5, maxResults: 20 })
    )
    .withFaceLandmarks()
    .withFaceDescriptors()

  if (!detections.length) {
    throw new SelfieQualityError(
      'No face found — use a clear, front-facing selfie.'
    )
  }

  // The guest is the largest face in their own selfie.
  const best = detections.reduce((a, b) =>
    b.detection.box.area > a.detection.box.area ? b : a
  )

  const minSide = Math.min(best.detection.box.width, best.detection.box.height)

  if (best.detection.score < MIN_DETECTION_SCORE || minSide < MIN_FACE_PX) {
    throw new SelfieQualityError(
      'Face is too small or unclear — move closer and use a well-lit selfie.'
    )
  }

  return {
    descriptor: Array.from(best.descriptor),
    faceCount: detections.length,
    previewUrl,
  }
}
