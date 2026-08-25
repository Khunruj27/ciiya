import { redirect } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{
    id: string
    personId: string
  }>
}

type PhotoRow = {
  id: string
  filename: string | null
  public_url: string | null
  preview_url: string | null
  thumbnail_url: string | null
  blur_data_url: string | null
  created_at: string | null
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

export default async function PersonPhotosPage({ params }: PageProps) {
  const { id: albumId, personId } = await params
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

  const { data: cluster, error: clusterError } = await supabaseAdmin
    .from('face_clusters')
    .select('id, label, face_count, album_id')
    .eq('id', personId)
    .eq('album_id', albumId)
    .maybeSingle()

  if (clusterError || !cluster) redirect(`/albums/${albumId}/people`)

  const { data: faces, error: facesError } = await supabaseAdmin
    .from('photo_faces')
    .select(
      `
      id,
      photo_id,
      confidence
      `
    )
    .eq('album_id', albumId)
    .or(`cluster_id.eq.${personId},person_cluster_id.eq.${personId}`)
    .order('confidence', { ascending: false })
    .limit(200)

  if (facesError) {
    throw new Error(facesError.message)
  }

  const photoIds = Array.from(
    new Set((faces || []).map((face) => face.photo_id).filter(Boolean))
  )

  const { data: photosData, error: photosError } =
    photoIds.length > 0
      ? await supabaseAdmin
          .from('photos')
          .select(
            `
            id,
            filename,
            public_url,
            preview_url,
            thumbnail_url,
            blur_data_url,
            created_at
            `
          )
          .in('id', photoIds)
          .eq('album_id', albumId)
          .order('created_at', { ascending: false })
      : { data: [], error: null }

  if (photosError) {
    throw new Error(photosError.message)
  }

  const photos = (photosData || []) as PhotoRow[]

  return (
    <main className="min-h-screen bg-ground px-5 pt-[max(32px,env(safe-area-inset-top))] pb-[max(120px,calc(env(safe-area-inset-bottom)+40px))] text-ink sm:px-8 lg:px-12">
      <div className="mx-auto w-full max-w-5xl">
        {/* HEADER */}
        <section className="flex items-center justify-between gap-4">
          <Link
            href={`/albums/${albumId}/people`}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-black/5 bg-white text-[#1C0617] transition active:scale-[0.96]"
            aria-label="กลับไปหน้าบุคคล"
          >
            <span className="text-[30px] font-light leading-none">‹</span>
          </Link>

          <div className="min-w-0 text-right">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-[#A0969B]">
              แกลเลอรีบุคคล
            </p>

            <h1 className="mt-1 truncate text-[30px] font-black leading-none tracking-[-0.06em]">
              {cluster.label || 'บุคคล'}
            </h1>
          </div>
        </section>

        {/* HERO */}
        <section className="mt-6 rounded-hero border border-gold/30 bg-gold-soft p-5 sm:p-7">
          <p className="text-[12px] font-black uppercase tracking-[0.16em] text-[#4A3140]">
            จัดกลุ่มใบหน้าด้วย AI
          </p>

          <h2 className="mt-2 text-[34px] font-black leading-[0.95] tracking-[-0.07em]">
            {cluster.label || 'บุคคล'}
          </h2>

          <p className="mt-3 text-[14px] font-semibold leading-relaxed text-[#4A3140]">
            รูปทั้งหมดที่ Ciiya AI ตรวจพบว่าเป็นบุคคลเดียวกันในอัลบั้มนี้
          </p>
        </section>

        {/* SUMMARY */}
        <section className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-[24px] border border-black/5 bg-white px-4 py-3">
            <p className="text-[12px] font-bold text-[#8E8E93]">
              อัลบั้ม
            </p>

            <p className="mt-1 truncate text-[18px] font-black tracking-[-0.04em]">
              {album.title}
            </p>
          </div>

          <div className="rounded-[24px] border border-gold/30 bg-gold-soft px-4 py-3">
            <p className="text-[12px] font-bold text-[#344318]">
              รูปภาพ
            </p>

            <p className="mt-1 text-[28px] font-black leading-none tracking-[-0.06em]">
              {photos.length}
            </p>
          </div>
        </section>

        {/* PHOTO GRID */}
        {photos.length === 0 ? (
          <section className="mt-5 rounded-[30px] border border-black/5 bg-white px-6 py-12 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#F6EEE6] text-[30px]">
              👤
            </div>

            <h2 className="mt-5 text-[20px] font-black tracking-[-0.04em]">
              ไม่พบรูปภาพ
            </h2>

            <p className="mx-auto mt-2 max-w-[280px] text-[14px] font-semibold leading-relaxed text-[#8E8E93]">
              กลุ่มบุคคลนี้ยังไม่มีรูปภาพที่เชื่อมโยง
            </p>
          </section>
        ) : (
          <section className="mt-5">
            <div className="mb-3 flex items-center justify-between px-1">
              <h2 className="text-[24px] font-black tracking-[-0.05em]">
                รูปภาพ
              </h2>

              <span className="rounded-full bg-white px-3 py-1.5 text-[12px] font-black text-[#1C0617]">
                {photos.length} รูป
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {photos.map((photo) => {
                const imageUrl =
                  photo.thumbnail_url || photo.preview_url || photo.public_url

                if (!imageUrl) return null

                const isOriginalFallback =
                  !photo.thumbnail_url && !photo.preview_url

                return (
                  <Link
                    key={photo.id}
                    href={`/albums/${albumId}`}
                    className="group overflow-hidden rounded-[28px] border border-black/5 bg-white p-2 transition active:scale-[0.98]"
                  >
                    <div className="relative aspect-[3/4] overflow-hidden rounded-[22px] bg-[#F2EEE9]">
                      {photo.blur_data_url ? (
                        <Image
                          src={photo.blur_data_url}
                          alt=""
                          aria-hidden="true"
                          fill
                          unoptimized
                          className="scale-110 object-cover blur-2xl"
                        />
                      ) : null}

                      <Image
                        src={imageUrl}
                        alt={photo.filename || 'photo'}
                        fill
                        sizes="(max-width: 640px) 50vw, 220px"
                        unoptimized={isOriginalFallback}
                        className="object-cover transition duration-500 group-active:scale-[1.03]"
                      />
                    </div>

                    <div className="px-1 pb-1 pt-3">
                      <p className="truncate text-[12px] font-bold text-[#8E8E93]">
                        {photo.filename || 'photo'}
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
