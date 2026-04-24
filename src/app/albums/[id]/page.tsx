import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import UploadPhotoForm from '@/components/upload-photo-form'
import ShareActions from '@/components/share-actions'
import DeletePhotoButton from '@/components/delete-photo-button'
import DeleteAlbumButton from '@/components/delete-album-button'
import EditAlbumForm from '@/components/edit-album-form'
import CoverCropUpload from '@/components/cover-crop-upload'

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function AlbumDetailPage({ params }: PageProps) {
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
    .select('*')
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
    .order('created_at', { ascending: false })

  if (photosError) {
    throw new Error(photosError.message)
  }

  const photoCount = photos?.length || 0

  const { data: categories, error: categoriesError } = await supabase
    .from('categories')
    .select('*')
    .eq('album_id', id)
    .order('created_at', { ascending: true })

  if (categoriesError) {
    throw new Error(categoriesError.message)
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <section className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 px-4 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center justify-between gap-4">
          <div className="min-w-0">
            <Link
              href="/albums"
              className="text-xs uppercase tracking-[0.2em] text-slate-400"
            >
              ← Back to Albums
            </Link>

            <h1 className="mt-1 truncate text-2xl font-bold text-slate-900">
              {album.title}
            </h1>

            <p className="mt-1 text-xs text-slate-500">
              {photoCount} photo{photoCount === 1 ? '' : 's'}
            </p>
          </div>

          <DeleteAlbumButton albumId={album.id} />
        </div>
      </section>

      <section className="px-4 py-6">
        <div className="mx-auto max-w-md space-y-4">
          <ShareActions shareToken={album.share_token ?? null} />

          <div className="overflow-hidden rounded-3xl bg-white shadow-sm">
            <div className="relative w-full overflow-hidden rounded-t-3xl bg-slate-200">
              <div className="aspect-[1125/600] w-full">
                {album.cover_url ? (
                  <img
                    src={album.cover_url}
                    alt={album.title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-sm text-slate-400">
                    No cover image yet
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-xl font-bold text-slate-900">
                    {album.title}
                  </h2>

                  <p className="mt-1 text-sm text-slate-500">
                    {album.description || 'No description'}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <EditAlbumForm
                    albumId={album.id}
                    initialTitle={album.title}
                    initialDescription={album.description}
                    iconOnly
                  />

                  <CoverCropUpload albumId={album.id} iconOnly />
                </div>
              </div>

            </div>
          </div>

          <UploadPhotoForm
            albumId={album.id}
            categories={categories || []}
          />

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {photos && photos.length > 0 ? (
              photos.map((photo) => (
                <div
                  key={photo.id}
                  className="overflow-hidden rounded-2xl bg-white shadow-sm"
                >
                  <div className="relative">
                    <img
                      src={photo.public_url}
                      alt={photo.filename || 'photo'}
                      className="aspect-square w-full object-cover"
                    />

                    <div className="absolute left-2 top-2 flex items-center gap-2">
                      <DeletePhotoButton photoId={photo.id} />
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="col-span-2 rounded-[28px] border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm sm:col-span-3">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-2xl">
                  🖼️
                </div>

                <h2 className="mt-4 text-lg font-semibold text-slate-900">
                  No photos yet
                </h2>

                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Upload your first JPG photo, then share this album with your
                  clients.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  )
}