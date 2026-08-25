export default function PricingLoading() {
  return (
    <main className="min-h-screen overflow-hidden bg-ground px-5 pt-[max(54px,env(safe-area-inset-top))] pb-[max(42px,env(safe-area-inset-bottom))] text-ink">
      <div className="mx-auto w-full max-w-[393px]">
        <div className="flex items-center justify-between">
          <div className="h-11 w-11 animate-pulse rounded-full bg-black/5" />
          <div className="h-8 w-20 animate-pulse rounded-full bg-black/5" />
        </div>

        <div className="mt-8 h-4 w-32 animate-pulse rounded-full bg-black/10" />
        <div className="mt-3 h-10 w-3/4 animate-pulse rounded-2xl bg-black/10" />

        <div className="mt-8 space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-40 w-full animate-pulse rounded-panel bg-black/10"
            />
          ))}
        </div>
      </div>
    </main>
  )
}
