import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import AlbumSettingsForm from '@/components/album-settings-form'

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function AlbumSettingsPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: album, error } = await supabase
    .from('albums')
    .select('*')
    .eq('id', id)
    .eq('owner_id', user.id)
    .single()

  if (error || !album) {
    throw new Error('Album not found')
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

        <AlbumSettingsForm
          albumId={album.id}
          initialTitle={album.title}
          initialDescription={album.description}
          initialAllowDownload={album.allow_download ?? true}
          initialIsPasswordProtected={album.is_password_protected ?? false}
        />
      </div>
    </main>
  )
}