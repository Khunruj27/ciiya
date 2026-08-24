export default function AlbumsLoading() {
  return (
    <main className="min-h-dvh overflow-x-hidden bg-ground text-black">
      <div className="mx-auto flex min-h-dvh w-full max-w-[393px] flex-col px-4 pt-[max(54px,env(safe-area-inset-top))] pb-[calc(104px+env(safe-area-inset-bottom))]">
        <section className="flex shrink-0 items-center justify-between">
          <div className="h-8 w-28 animate-pulse rounded-full bg-black/10" />
          <div className="h-11 w-11 animate-pulse rounded-full bg-black/10" />
        </section>

        <section className="pt-6">
          <div className="h-9 w-48 animate-pulse rounded-2xl bg-black/10" />
          <div className="mt-3 h-4 w-32 animate-pulse rounded-full bg-black/10" />
        </section>

        <section className="pt-6">
          <div className="h-[132px] w-full animate-pulse rounded-panel bg-black/10" />
        </section>

        <section className="pt-5">
          <div className="mb-3 h-6 w-32 animate-pulse rounded-full bg-black/10" />

          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="flex w-full gap-3 rounded-panel bg-surface p-2 border border-line"
              >
                <div className="h-[86px] w-[96px] shrink-0 animate-pulse rounded-card bg-black/10" />
                <div className="flex-1 py-1 pr-7">
                  <div className="h-4 w-3/4 animate-pulse rounded-full bg-black/10" />
                  <div className="mt-2 h-4 w-14 animate-pulse rounded-full bg-black/10" />
                  <div className="mt-3 h-3 w-full animate-pulse rounded-full bg-black/10" />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
