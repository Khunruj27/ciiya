export function formatStorage(bytes: number): string {
  if (!bytes) return '0 GB'

  const gb = bytes / (1024 * 1024 * 1024)

  if (gb >= 1) {
    return `${gb.toFixed(gb < 10 ? 1 : 0)} GB`
  }

  const mb = bytes / (1024 * 1024)
  return `${mb.toFixed(0)} MB`
}