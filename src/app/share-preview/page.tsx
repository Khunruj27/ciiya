import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import SharePreviewClient from '@/components/share-preview-client'
import { getPreviewSample } from '@/lib/share-data'

export const metadata: Metadata = {
  title: 'Share gallery redesign preview — Ciiya',
  description: 'A local visual preview for the redesigned Ciiya share gallery.',
  robots: {
    index: false,
    follow: false,
  },
}

// Design explorations carry scaffolding copy and are not part of the
// product, so they never become reachable URLs on the public site.
export default async function SharePreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  const sample = await getPreviewSample()

  return (
    <SharePreviewClient
      photos={sample?.photos ?? []}
      albumTitle={sample?.album.title ?? ''}
      albumDescription={sample?.album.description ?? ''}
      photoCount={sample?.photoCount ?? 0}
    />
  )
}
