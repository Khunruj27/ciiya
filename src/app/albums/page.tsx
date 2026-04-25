import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import CreateAlbumForm from '@/components/create-album-form'
import LogoutButton from '@/components/logout-button'
import { formatBytes, clampPercent } from '@/lib/format-bytes'
import ManageBillingButton from '@/components/manage-billing-button'

export default async function AlbumsPage() {
  const supabase = await createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // ✅ FIX: กัน null
  const { data: albumsData } = await supabase
    .from('albums')
    .select('*')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false })

  const albums = albumsData ?? []

  // ✅ FIX: กัน null
  const { data: storageRowsData } = await supabase
    .from('photos')
    .select('file_size_bytes')
    .eq('owner_id', user.id)

  const storageRows = storageRowsData ?? []

  const { data: currentSubscription } = await supabase
    .from('subscriptions')
    .select(`
      id,
      user_id,
      plan_id,
      status,
      stripe_customer_id,
      stripe_subscription_id,
      created_at,
      plan:plans(*)
    `)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // ✅ FIX: plan อาจเป็น array
  const currentPlan = Array.isArray(currentSubscription?.plan)
    ? currentSubscription?.plan[0]
    : currentSubscription?.plan

  const totalBytes = storageRows.reduce(
    (sum, row) => sum + Number(row.file_size_bytes || 0),
    0
  )

  const storageLimitBytes = Number(
    currentPlan?.storage_limit_bytes || 3 * 1024 * 1024 * 1024
  )

  const usagePercent = clampPercent(
    storageLimitBytes > 0 ? (totalBytes / storageLimitBytes) * 100 : 0
  )

  let barColor = 'bg-[#3B5BFF]'
  let textColor = 'text-[#3B5BFF]'
  let bgColor = 'bg-[#EEF2FF]'

  if (usagePercent >= 90) {
    barColor = 'bg-red-500'
    textColor = 'text-red-600'
    bgColor = 'bg-red-50'
  } else if (usagePercent >= 70) {
    barColor = 'bg-yellow-500'
    textColor = 'text-yellow-600'
    bgColor = 'bg-yellow-50'
  }

  const albumCount = albums.length
  const currentPlanName = currentPlan?.name || 'Free 3GB'
  const hasBillingPortal = Boolean(currentSubscription?.stripe_customer_id)

  return (
    <main className="min-h-screen bg-[#FBFAF8] pb-28">
      <section className="px-5 pb-4 pt-8">
        <div className="mx-auto flex max-w-md items-start justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-[#3B5BFF]">
              Racky
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-tight text-slate-950">
              Albums
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              {albumCount} album • {user.email}
            </p>
          </div>

          <LogoutButton />
        </div>
      </section>

      <section className="px-5 py-3">
        <div className="mx-auto max-w-md space-y-5">
          {/* STORAGE */}
          <div className="rounded-[32px] bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.08)] ring-1 ring-black/5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-950">
                  Your Storage
                </h2>
                <p className="text-sm text-slate-500">
                  Current plan: {currentPlanName}
                </p>
              </div>

              <div
                className={`rounded-full px-3 py-2 text-sm font-bold ${bgColor} ${textColor}`}
              >
                {Math.round(usagePercent)}%
              </div>
            </div>

            <div className="mt-5">
              <div className="h-3 w-full rounded-full bg-slate-100 overflow-hidden">
                <div
                  className={`h-full ${barColor}`}
                  style={{ width: `${usagePercent}%` }}
                />
              </div>

              <div className="mt-3 flex justify-between text-sm">
                <span>{formatBytes(totalBytes)}</span>
                <span>{formatBytes(storageLimitBytes)}</span>
              </div>

              {/* 🔥 UX แจ้งเตือน */}
              {usagePercent >= 80 && (
                <p className="mt-3 text-xs text-red-500">
                  ⚠️ Storage almost full — upgrade now
                </p>
              )}

              <div className="mt-4 flex gap-2">
                <Link
                  href="/pricing"
                  className="bg-[#3B5BFF] text-white px-4 py-2 rounded-full text-sm"
                >
                  Upgrade
                </Link>

                {hasBillingPortal && <ManageBillingButton />}
              </div>
            </div>
          </div>

          {/* CREATE */}
          <div className="rounded-[32px] bg-white shadow ring-1 ring-black/5">
            <CreateAlbumForm />
          </div>

          {/* LIST */}
          {albums.length > 0 ? (
            <div className="space-y-4">
              {albums.map((album) => (
                <Link
                  key={album.id}
                  href={`/albums/${album.id}`}
                  className="block rounded-[32px] bg-white p-4 shadow ring-1 ring-black/5"
                >
                  <div className="h-44 bg-slate-100 rounded-xl overflow-hidden">
                    {album.cover_url ? (
                      <img
                        src={album.cover_url}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full text-slate-400">
                        No Cover
                      </div>
                    )}
                  </div>

                  <h2 className="mt-3 text-xl font-bold">
                    {album.title || 'Untitled'}
                  </h2>

                  <p className="text-sm text-slate-500">
                    {album.description || 'No description'}
                  </p>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center p-8 bg-white rounded-3xl border">
              No albums yet
            </div>
          )}
        </div>
      </section>
    </main>
  )
}