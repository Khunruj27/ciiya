/*
 * Downscales an image file in the browser to a JPEG blob before upload.
 * Phone cameras hand back 6–12MP originals; a portfolio never displays them
 * larger than a screen width, so shrinking to a sane long edge keeps the
 * gallery quick to load and the owner's storage from filling up on covers.
 */
export async function resizeImageToJpeg(
  file: File,
  maxDimension = 2000,
  quality = 0.85
): Promise<Blob> {
  const dataUrl = await readAsDataUrl(file)
  const image = await loadImage(dataUrl)

  const { width, height } = image
  const scale = Math.min(1, maxDimension / Math.max(width, height))
  const targetWidth = Math.round(width * scale)
  const targetHeight = Math.round(height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')

  ctx.drawImage(image, 0, 0, targetWidth, targetHeight)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('encode failed'))),
      'image/jpeg',
      quality
    )
  })
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = src
  })
}
