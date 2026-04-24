import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import CreateAlbumForm from '@/components/create-album-form'
import LogoutButton from '@/components/logout-button'
import { formatBytes, clampPercent } from '@/lib/format-bytes'

export default async function AlbumsPage() {
  const supabase = await createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: albums } = await supabase
    .from('albums')
    .select('*')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false })

  const { data: storageRows } = await supabase
    .from('photos')
    .select('file_size_bytes')
    .eq('owner_id', user.id)

  const { data: currentSubscription } = await supabase
    .from('subscriptions')
    .select(`
      *,
      plan:plans(*)
    `)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const totalBytes =
    storageRows?.reduce((sum, row) => sum + Number(row.file_size_bytes || 0), 0) || 0

  const storageLimitBytes =
    currentSubscription?.plan?.storage_limit_bytes || 10 * 1024 * 1024 * 1024

  const usagePercent = clampPercent((totalBytes / storageLimitBytes) * 100)

  let barColor = 'bg-blue-600'
  let textColor = 'text-blue-600'
  let bgColor = 'bg-blue-50'

  if (usagePercent >= 90) {
    barColor = 'bg-red-500'
    textColor = 'text-red-600'
    bgColor = 'bg-red-50'
  } else if (usagePercent >= 70) {
    barColor = 'bg-yellow-500'
    textColor = 'text-yellow-600'
    bgColor = 'bg-yellow-50'
  }

  const albumCount = albums?.length || 0
  const currentPlanName = currentSubscription?.plan?.name || 'Free'

  return (
    <main className="min-h-screen bg-slate-50 pb-24">
      <section className="border-b border-slate-200 bg-white px-4 py-6">
        <div className="mx-auto flex max-w-md items-start justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-slate-400">
              Racky
            </p>
            <h1 className="mt-2 text-4xl font-bold text-slate-900">Albums</h1>
            <p className="mt-2 text-sm text-slate-500">
              {albumCount} album • {user.email}
            </p>
          </div>

          <LogoutButton />
        </div>
      </section>

      <section className="px-4 py-6">
        <div className="mx-auto max-w-md space-y-4">
          <div className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-black/5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Storage usage
                </h2>
                <p className="text-sm text-slate-500">
                  Current plan: {currentPlanName}
                </p>
              </div>

              <div
                className={`rounded-full px-3 py-2 text-sm font-medium ${bgColor} ${textColor}`}
              >
                {Math.round(usagePercent)}%
              </div>
            </div>

            <div className="mt-4">
              <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className={`h-full rounded-full ${barColor} transition-all duration-700 ease-out`}
                  style={{ width: `${usagePercent}%` }}
                />
              </div>

              <div className="mt-3 flex items-center justify-between text-sm">
                <span className="font-medium text-slate-900">
                  {formatBytes(totalBytes)}
                </span>
                <span className="text-slate-500">
                  / {formatBytes(storageLimitBytes)}
                </span>
              </div>

              <Link
                href="/pricing"
                className="mt-4 inline-flex rounded-2xl bg-blue-600 px-4 py-3 text-sm text-white"
              >
                Upgrade Plan
              </Link>
            </div>
          </div>

          <CreateAlbumForm />

          {albums?.map((album) => (
            <Link
              key={album.id}
              href={`/albums/${album.id}`}
              className="block rounded-3xl bg-white p-4 shadow-sm ring-1 ring-black/5 hover:shadow-md"
            >
              <div className="flex gap-4">
                <div className="h-28 w-28 overflow-hidden rounded-3xl bg-slate-200">
                  {album.cover_url ? (
                    <img
                      src={album.cover_url}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-slate-400">
                      No Cover
                    </div>
                  )}
                </div>

                <div className="flex-1">
                  <h2 className="text-xl font-bold">{album.title}</h2>
                  <p className="text-sm text-slate-500">
                    {album.description || 'No description'}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </main>
  )
}