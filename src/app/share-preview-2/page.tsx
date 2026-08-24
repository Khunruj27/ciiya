import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import SharePreviewEditorial from '@/components/share-preview-editorial'
import { getPreviewSample } from '@/lib/share-data'

export const metadata: Metadata = {
  title: 'Editorial share gallery preview — Ciiya',
  description: 'A second local design direction for the Ciiya share gallery.',
  robots: {
    index: false,
    follow: false,
  },
}

// Design explorations carry scaffolding copy and are not part of the
// product, so they never become reachable URLs on the public site.
export default async function SharePreviewTwoPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  const sample = await getPreviewSample()

  return (
    <SharePreviewEditorial
      photos={sample?.photos ?? []}
      albumTitle={sample?.album.title ?? ''}
      albumDescription={sample?.album.description ?? ''}
      photoCount={sample?.photoCount ?? 0}
    />
  )
}
