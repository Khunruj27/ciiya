import { redirect } from 'next/navigation'

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function AlbumCameraPage({ params }: PageProps) {
  const { id } = await params

  redirect(`/albums/${id}`)
}