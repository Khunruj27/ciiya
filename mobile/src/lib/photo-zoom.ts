/** Geometry is shared by the iOS/Android UI worklets and offline regression tests. */
export function clampZoom(scale: number): number {
  'worklet';
  if (!Number.isFinite(scale) || scale <= 1.01) return 1;
  return Math.min(scale, 4);
}

export function containSize(
  imageWidth: number | null,
  imageHeight: number | null,
  viewportWidth: number,
  viewportHeight: number
): { width: number; height: number } {
  'worklet';
  if (
    !imageWidth || !imageHeight ||
    !Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) ||
    imageWidth <= 0 || imageHeight <= 0
  ) {
    return { width: viewportWidth, height: viewportHeight };
  }
  const fit = Math.min(viewportWidth / imageWidth, viewportHeight / imageHeight);
  return { width: imageWidth * fit, height: imageHeight * fit };
}

/** Never pan past the edge of the contained image, including letterboxed axes. */
export function clampPhotoOffset(offset: number, imageExtent: number, viewportExtent: number): number {
  'worklet';
  const bound = Math.max(0, (imageExtent - viewportExtent) / 2);
  if (bound === 0) return 0;
  return Math.max(-bound, Math.min(Number.isFinite(offset) ? offset : 0, bound));
}

/** Keep the image point beneath the pinch's focal point under the moving fingers. */
export function pinchPhotoOffset(
  startOffset: number,
  startScale: number,
  nextScale: number,
  startFocal: number,
  currentFocal: number,
  viewportExtent: number
): number {
  'worklet';
  const center = viewportExtent / 2;
  return currentFocal - center - (startFocal - center - startOffset) * (nextScale / startScale);
}

/** A reported total is not an addressable page until its photo has loaded. */
export function adjacentPhotoIndex(index: number, direction: -1 | 1, loadedCount: number): number | null {
  if (
    !Number.isSafeInteger(index) || !Number.isSafeInteger(loadedCount) || loadedCount <= 0 ||
    index < 0 || index >= loadedCount || (direction !== -1 && direction !== 1)
  ) return null;
  const next = index + direction;
  return next >= 0 && next < loadedCount ? next : null;
}

/** Native bounce is bounded; malformed offsets never select an unrelated photo. */
export function photoIndexFromOffset(offset: number, viewportWidth: number, loadedCount: number): number | null {
  if (
    !Number.isFinite(offset) || !Number.isFinite(viewportWidth) || viewportWidth <= 0 ||
    !Number.isSafeInteger(loadedCount) || loadedCount <= 0
  ) return null;
  return Math.max(0, Math.min(Math.round(offset / viewportWidth), loadedCount - 1));
}
