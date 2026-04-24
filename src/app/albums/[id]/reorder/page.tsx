import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import ReorderPhotosBoard from '@/components/reorder-photos-board'

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function ReorderPhotosPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: album, error: albumError } = await supabase
    .from('albums')
    .select('id, title, owner_id')
    .eq('id', id)
    .eq('owner_id', user.id)
    .single()

  if (albumError || !album) {
    throw new Error('Album not found')
  }

  const { data: photos, error: photosError } = await supabase
    .from('photos')
    .select('*')
    .eq('album_id', id)
    .eq('owner_id', user.id)
    .order('position', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })

  if (photosError) {
    throw new Error(photosError.message)
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto max-w-md space-y-4">
        <Link
          href={`/albums/${album.id}`}
          className="text-xs uppercase tracking-[0.2em] text-slate-400"
        >
          ← Back to Album
        </Link>

        <div className="rounded-3xl bg-white p-4 shadow-sm">
          <h1 className="text-2xl font-bold text-slate-900">{album.title}</h1>
          <p className="mt-1 text-sm text-slate-500">
            Arrange the photo sequence for this album
          </p>
        </div>

        <ReorderPhotosBoard albumId={album.id} photos={photos || []} />
      </div>
    </main>
  )
}