/**
 * Single-photo retry. It used to upsert the photo's job with size `original`
 * and no preset, silently changing how the photo was processed. It now runs
 * the same owner-checked, reset-in-place retry as the album grid's button,
 * which keeps size, preset and paths exactly as uploaded.
 */
export { POST } from '@/app/api/photos/retry-processing/route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
