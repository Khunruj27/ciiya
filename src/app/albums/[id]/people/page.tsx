import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ id: string }>
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error('Missing Supabase env')
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

export default async function AlbumPeoplePage({ params }: PageProps) {
  const { id: albumId } = await params
  const supabase = await createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: album, error: albumError } = await supabase
    .from('albums')
    .select('id, title, owner_id, user_id')
    .eq('id', albumId)
    .or(`owner_id.eq.${user.id},user_id.eq.${user.id}`)
    .maybeSingle()

  if (albumError || !album) redirect('/albums')

  const supabaseAdmin = getSupabaseAdmin()

  const { data: clusters, error: clustersError } = await supabaseAdmin
    .from('face_clusters')
    .select('id, label, face_count, preview_photo_id, created_at')
    .eq('album_id', albumId)
    .order('face_count', { ascending: false })

  if (clustersError) throw new Error(clustersError.message)

  const previewIds = (clusters || [])
    .map((cluster) => cluster.preview_photo_id)
    .filter(Boolean)

  const { data: previewPhotos } =
    previewIds.length > 0
      ? await supabaseAdmin
          .from('photos')
          .select(
            'id, filename, public_url, preview_url, thumbnail_url, blur_data_url'
          )
          .in('id', previewIds)
      : { data: [] }

  const photoMap = new Map(
    (previewPhotos || []).map((photo) => [photo.id, photo])
  )

  const people = (clusters || []).map((cluster) => ({
    ...cluster,
    preview_photo: cluster.preview_photo_id
      ? photoMap.get(cluster.preview_photo_id) || null
      : null,
  }))

  return (
    <main className="min-h-screen bg-[#FAF7F4] px-5 pt-[max(56px,env(safe-area-inset-top))] pb-[max(120px,calc(env(safe-area-inset-bottom)+40px))] text-[#1C0617]">
      <div className="mx-auto w-full max-w-[430px]">
        {/* HEADER */}
        <section className="flex items-center justify-between gap-4">
          <Link
            href={`/albums/${albumId}`}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-black/5 bg-white text-[#1C0617] transition active:scale-[0.96]"
            aria-label="Back to album"
          >
            <span className="text-[30px] font-light leading-none">‹</span>
          </Link>

          <div className="min-w-0 text-right">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-[#A0969B]">
              Ciiya AI
            </p>

            <h1 className="mt-1 truncate text-[30px] font-black leading-none tracking-[-0.06em]">
              People
            </h1>
          </div>
        </section>

        {/* HERO */}
        <section className="mt-6 rounded-[34px] border border-black/5 bg-[#F0B1DE] p-5">
          <p className="text-[12px] font-black uppercase tracking-[0.16em] text-[#4A3140]">
            AI Collection
          </p>

          <h2 className="mt-2 text-[34px] font-black leading-[0.95] tracking-[-0.07em]">
            People in this album
          </h2>

          <p className="mt-3 text-[14px] font-semibold leading-relaxed text-[#4A3140]">
            Browse faces detected by AI and open each person’s photo collection.
          </p>
        </section>

        {/* SUMMARY */}
        <section className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-[24px] border border-black/5 bg-white px-4 py-3">
            <p className="text-[12px] font-bold text-[#8E8E93]">
              Album
            </p>

            <p className="mt-1 truncate text-[18px] font-black tracking-[-0.04em]">
              {album.title}
            </p>
          </div>

          <div className="rounded-[24px] border border-black/5 bg-[#D0F578] px-4 py-3">
            <p className="text-[12px] font-bold text-[#344318]">
              Groups
            </p>

            <p className="mt-1 text-[28px] font-black leading-none tracking-[-0.06em]">
              {people.length}
            </p>
          </div>
        </section>

        {/* PEOPLE GRID */}
        {people.length === 0 ? (
          <section className="mt-5 rounded-[30px] border border-black/5 bg-white px-6 py-12 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#F6EEE6] text-[30px]">
              👤
            </div>

            <h2 className="mt-5 text-[20px] font-black tracking-[-0.04em]">
              No people found yet
            </h2>

            <p className="mx-auto mt-2 max-w-[280px] text-[14px] font-semibold leading-relaxed text-[#8E8E93]">
              Face results will appear after AI processing is complete.
            </p>
          </section>
        ) : (
          <section className="mt-5">
            <div className="mb-3 flex items-center justify-between px-1">
              <h2 className="text-[24px] font-black tracking-[-0.05em]">
                Face Gallery
              </h2>

              <span className="rounded-full bg-white px-3 py-1.5 text-[12px] font-black text-[#1C0617]">
                {people.length} group{people.length === 1 ? '' : 's'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {people.map((person, index) => {
                const photo = person.preview_photo
                const imageUrl =
                  photo?.thumbnail_url ||
                  photo?.preview_url ||
                  photo?.public_url ||
                  null

                return (
                  <Link
                    key={person.id}
                    href={`/albums/${albumId}/people/${person.id}`}
                    className="group overflow-hidden rounded-[30px] border border-black/5 bg-white p-2 transition active:scale-[0.98]"
                  >
                    <div className="relative aspect-square overflow-hidden rounded-[24px] bg-[#F2EEE9]">
                      {photo?.blur_data_url ? (
                        <img
                          src={photo.blur_data_url}
                          alt=""
                          aria-hidden="true"
                          className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl"
                        />
                      ) : null}

                      {imageUrl ? (
                        <img
                          src={imageUrl}
                          alt={person.label || `Person ${index + 1}`}
                          className="relative h-full w-full object-cover transition duration-500 group-active:scale-[1.03]"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[34px]">
                          👤
                        </div>
                      )}
                    </div>

                    <div className="px-1 pb-1 pt-3">
                      <p className="truncate text-[15px] font-black tracking-[-0.03em]">
                        {person.label || `Person ${index + 1}`}
                      </p>

                      <p className="mt-1 text-[12px] font-bold text-[#8E8E93]">
                        {person.face_count || 0} face
                        {(person.face_count || 0) === 1 ? '' : 's'}
                      </p>
                    </div>
                  </Link>
                )
              })}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}