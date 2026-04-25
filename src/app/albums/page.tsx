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

  const { data: albums = [] } = await supabase
    .from('albums')
    .select('*')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false })

  const { data: storageRows = [] } = await supabase
    .from('photos')
    .select('file_size_bytes')
    .eq('owner_id', user.id)

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

  const storageRowsSafe = storageRows ?? []

const totalBytes = storageRowsSafe.reduce(
  (sum, row) => sum + Number(row.file_size_bytes || 0),
  0
)

  const storageLimitBytes =
    currentSubscription?.plan?.storage_limit_bytes ||
    3 * 1024 * 1024 * 1024

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
  const currentPlanName = currentSubscription?.plan?.name || 'Free'
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
          <div className="rounded-[32px] bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.08)] ring-1 ring-black/5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-950">
                  Storage usage
                </h2>
                <p className="mt-1 text-sm text-slate-500">
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
              <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full ${barColor} transition-all duration-700`}
                  style={{ width: `${usagePercent}%` }}
                />
              </div>

              <div className="mt-3 flex items-center justify-between text-sm">
                <span className="font-semibold text-slate-900">
                  {formatBytes(totalBytes)}
                </span>
                <span className="text-slate-500">
                  / {formatBytes(storageLimitBytes)}
                </span>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <Link
                  href="/pricing"
                  className="rounded-full bg-[#3B5BFF] px-5 py-2.5 text-sm font-semibold text-white shadow-sm"
                >
                  Upgrade Plan
                </Link>

                {hasBillingPortal ? <ManageBillingButton /> : null}
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-[32px] bg-white shadow-[0_14px_40px_rgba(15,23,42,0.08)] ring-1 ring-black/5">
            <CreateAlbumForm />
          </div>

          {albums.length > 0 ? (
            <div className="space-y-4">
              {albums.map((album) => (
                <Link
                  key={album.id}
                  href={`/albums/${album.id}`}
                  className="block overflow-hidden rounded-[32px] bg-white shadow-[0_14px_40px_rgba(15,23,42,0.08)] ring-1 ring-black/5 transition hover:-translate-y-0.5 hover:shadow-[0_18px_50px_rgba(15,23,42,0.12)]"
                >
                  <div className="p-4">
                    <div className="h-44 overflow-hidden rounded-[26px] bg-slate-100">
                      {album.cover_url ? (
                        <img
                          src={album.cover_url}
                          alt={album.title || 'Album cover'}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-sm text-slate-400">
                          No Cover
                        </div>
                      )}
                    </div>

                    <div className="mt-4">
                      <h2 className="truncate text-2xl font-black tracking-tight text-slate-950">
                        {album.title || 'Untitled album'}
                      </h2>

                      <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-500">
                        {album.description || 'No description'}
                      </p>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <span className="rounded-full bg-[#EEF2FF] px-3 py-1.5 text-xs font-semibold text-[#3B5BFF]">
                          Owner
                        </span>

                        <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600">
                          Share Ready
                        </span>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-[32px] border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-2xl">
                🖼️
              </div>
              <h2 className="mt-4 text-lg font-bold text-slate-900">
                No albums yet
              </h2>
              <p className="mt-2 text-sm text-slate-500">
                Create your first album to start sharing photos.
              </p>
            </div>
          )}
        </div>
      </section>
    </main>
  )
}