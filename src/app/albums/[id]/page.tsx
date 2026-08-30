import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import ShareActions from '@/components/share-actions'
import EditAlbumForm from '@/components/edit-album-form'
import CoverCropUpload from '@/components/cover-crop-upload'
import AlbumRealtimeRefresher from '@/components/album-realtime-refresher'
import AppIcon from '@/components/app-icon'
import AlbumCameraStatus from '@/components/album-camera-status'
import UploadPhotoModal from '@/components/upload-photo-modal'
import AlbumPhotoGridPreview from '@/components/album-photo-grid-preview'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function AlbumDetailPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()

    let user = null

  try {
    const result = await supabase.auth.getUser()
    user = result.data.user
  } catch (error) {
    console.warn('[album detail] auth getUser failed:', error)

    return (
      <main className="min-h-screen bg-ground px-6 py-10 text-ink">
        <div className="mx-auto max-w-[393px] rounded-hero bg-surface p-6 text-center border border-line">
          <h1 className="text-[24px] font-bold">
            Connection problem
          </h1>

          <p className="mt-3 text-[14px] font-semibold leading-6 text-muted">
            Can’t reach the server right now. Please reload the page
          </p>

          <Link
            href={`/albums/${id}`}
            className="mt-5 inline-flex h-11 items-center justify-center rounded-full bg-ink px-5 text-[13px] font-bold text-white"
          >
            Reload
          </Link>
        </div>
      </main>
    )
  }

  if (!user) redirect('/login')

  const { data: album, error: albumError } = await supabase
    .from('albums')
    .select('*')
    .eq('id', id)
    .eq('owner_id', user.id)
    .single()

  if (albumError || !album) {
    redirect('/albums')
  }

  let shareToken = album.share_token

  if (!shareToken) {
    const newToken = crypto.randomUUID()

    await supabase
      .from('albums')
      .update({ share_token: newToken })
      .eq('id', album.id)
      .eq('owner_id', user.id)

    shareToken = newToken
  }

  const [
    photosResult,
    peopleCountResult,
    categoriesResult,
    cameraImportsResult,
  ] = await Promise.all([
    supabase
      .from('photos')
      .select(
        `
        id,
        album_id,
        owner_id,
        filename,
        file_name,
        original_path,
        public_url,
        preview_url,
        thumbnail_url,
        hd_url,
        uhd_url,
        blur_data_url,
        processing_status,
        processing_progress,
        created_at
        `
      )
      .eq('album_id', id)
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('face_clusters')
      .select('id', {
        count: 'exact',
        head: true,
      })
      .eq('album_id', id),
    supabase
      .from('categories')
      .select('*')
      .eq('album_id', id)
      .order('created_at', { ascending: true }),
    supabase
      .from('camera_live_imports')
      .select('id, filename, status, progress, storage_path, created_at')
      .eq('album_id', id)
      .in('status', ['imported', 'uploading', 'finalizing'])
      .order('created_at', { ascending: false })
      .limit(24),
  ])

  const { data: photosData, error: photosError } = photosResult

  if (photosError) throw new Error(photosError.message)

  const photos = photosData ?? []
  const photoCount = photos.length

  const { count: peopleCount } = peopleCountResult

  const { data: categoriesData, error: categoriesError } = categoriesResult

  if (categoriesError) {
  console.error(
    '[AlbumDetailPage] categories fetch failed:',
    categoriesError.message
  )
}

const categories = categoriesError ? [] : categoriesData ?? []

    const { data: cameraImportsData } = cameraImportsResult

const existingPhotoNames = new Set(
  photos
    .map((photo) =>
      String(
        photo.filename ||
          photo.file_name ||
          photo.original_path?.split('/').pop() ||
          ''
      ).toLowerCase()
    )
    .filter(Boolean)
)

const cameraProcessingGridItems = (cameraImportsData || [])
  .filter((item) =>
    ['imported', 'uploading', 'finalizing'].includes(
      String(item.status || '').toLowerCase()
    )
  )
  .filter(
    (item) =>
      !existingPhotoNames.has(
        String(item.filename || '').toLowerCase()
      )
  )
  .map((item) => ({
    id: item.id,
    filename: item.filename || 'Photo from camera',
    status: String(item.status || 'imported'),
    progress: Number(item.progress || 0),
    created_at: String(item.created_at || new Date().toISOString()),
    previewUrl: item.storage_path
      ? supabase.storage.from('albums').getPublicUrl(item.storage_path).data
          .publicUrl
      : null,
  }))

  return (
  <main className="min-h-screen bg-ground text-ink">
      <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-5 pt-[max(28px,env(safe-area-inset-top))] pb-[calc(112px+env(safe-area-inset-bottom))] sm:px-8 sm:pt-8 lg:px-12">
        {/* HEADER */}
        <section className="pt-2 sm:pt-4">
          <div className="flex items-center justify-between">
            <Link
              href="/albums"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-surface text-2xl font-bold border border-line"
            >
              ‹
            </Link>

           <div className="flex items-center gap-3">
              <Link
                href={`/albums/${album.id}/analytics`}
                className="flex h-11 items-center justify-center rounded-full border border-line bg-surface px-4 text-[12px] font-semibold text-ink transition active:scale-95"
              >
                Analytics
              </Link>

              <EditAlbumForm
                albumId={album.id}
                initialTitle={album.title}
                initialDescription={album.description}
                iconOnly
              />

              <CoverCropUpload albumId={album.id} iconOnly />
            </div>
          </div>
 
          <section className="pt-8 sm:pt-12">
          <h1 className="mt-3 text-[clamp(2.3rem,6vw,4.5rem)] font-semibold leading-[0.96] tracking-[-0.055em] text-ink">
           {album.title}
          </h1>

          <p className="mt-2 text-[14px] font-semibold leading-relaxed text-muted">
             {album.description || 'No description yet'}
          </p>
          </section>
        </section>
        
       {/* SUMMARY CARDS */}
<section className="mt-7 grid grid-cols-2 gap-3 sm:max-w-md">
  <div className="rounded-panel border border-line bg-gold-soft px-4 py-3">
    <p className="text-[12px] font-bold text-gold-deep">
      All photos
    </p>

    <p className="mt-1 text-[26px] font-bold leading-none tracking-[-0.05em] text-ink">
      {photoCount}
    </p>
  </div>

  <Link
    href={`/albums/${album.id}/people`}
    className="rounded-panel border border-line bg-gold-soft px-4 py-3 transition active:scale-[0.98]"
  >
    <p className="text-[12px] font-bold text-gold-deep">
      People in this job
    </p>

    <p className="mt-1 text-[26px] font-bold leading-none tracking-[-0.05em] text-ink">
      {peopleCount || 0}
    </p>
  </Link>
</section>

<AlbumCameraStatus albumId={album.id} />


        {/* PHOTO GRID */}
        <section className="mt-6">
          <div className="rounded-panel bg-surface border border-line p-4 sm:p-6">
            {/* Sharing lives on this row now. It used to sit in a card of its
                own whose only content was these three buttons, so moving them
                took the card with it. */}
            <div className="mb-4 flex items-center justify-between gap-4">
              <h2 className="text-[24px] font-bold tracking-[-0.05em] sm:text-[30px]">
                Photos
              </h2>

              <div className="shrink-0 rounded-full border border-line bg-surface px-3 py-2">
                <ShareActions shareToken={shareToken} />
              </div>
            </div>

            {photos.length > 0 || cameraProcessingGridItems.length > 0 ? (
  <AlbumPhotoGridPreview
  albumId={album.id}
  photos={photos}
  cameraProcessingItems={cameraProcessingGridItems}
/>
) : (
              <div className="rounded-panel bg-ground-sunken px-6 py-12 text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-surface shadow-sm">
                  <AppIcon name="album" size={60} className="opacity-30" />
                </div>

                <p className="mt-5 text-[22px] font-semibold text-ink">
                  No photos yet
                </p>

                <p className="mt-2 text-sm font-medium leading-6 text-muted">
                  Upload the first photo of this job, then share the gallery with your client
                </p>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* FLOATING BOTTOM NAV */}
<nav className="fixed left-0 right-0 z-50 bottom-[max(20px,env(safe-area-inset-bottom))] flex justify-center px-5">
        <div className="inline-flex items-center gap-2 rounded-[18px] border border-line bg-surface/95 px-2 py-2 shadow-lift backdrop-blur-xl sm:gap-3">
    <Link
      href="/albums"
      className="flex h-11 w-11 items-center justify-center rounded-full text-muted transition active:scale-95"
    >
      <AppIcon name="album" size={24} />
    </Link>

    <div className="flex h-12 w-12 items-center justify-center">
  <UploadPhotoModal
    albumId={album.id}
    categories={categories}
    initialAutoFaceScan={album.auto_face_scan}
    initialAutoPublish={album.auto_publish}
  />
</div>

    <Link
      href="/me"
      className="flex h-11 w-11 items-center justify-center rounded-full text-muted transition active:scale-95"
    >
      <AppIcon name="user-1" size={23} />
    </Link>
  </div>
</nav>

      <AlbumRealtimeRefresher albumId={album.id} />
    </main>
  )
}
