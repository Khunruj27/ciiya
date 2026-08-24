export default function MeLoading() {
  return (
    <main className="min-h-screen bg-ground px-5 pt-[max(54px,env(safe-area-inset-top))] pb-[max(42px,env(safe-area-inset-bottom))] text-ink">
      <div className="mx-auto w-full max-w-[393px]">
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 animate-pulse rounded-full bg-black/10" />
          <div className="flex-1">
            <div className="h-5 w-1/2 animate-pulse rounded-full bg-black/10" />
            <div className="mt-2 h-4 w-1/3 animate-pulse rounded-full bg-black/10" />
          </div>
        </div>

        <div className="mt-8 h-24 w-full animate-pulse rounded-panel bg-black/10" />

        <div className="mt-6 grid grid-cols-2 gap-3">
          <div className="h-20 animate-pulse rounded-panel bg-black/10" />
          <div className="h-20 animate-pulse rounded-panel bg-black/10" />
        </div>

        <div className="mt-8 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-16 w-full animate-pulse rounded-card bg-black/10"
            />
          ))}
        </div>
      </div>
    </main>
  )
}
