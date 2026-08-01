export default function AlbumDetailLoading() {
  return (
    <main className="min-h-screen bg-[#FAF7F4] px-4 pt-[max(54px,env(safe-area-inset-top))] pb-16 text-[#1C0617]">
      <div className="mx-auto w-full max-w-[393px]">
        <div className="flex items-center justify-between">
          <div className="h-11 w-11 animate-pulse rounded-full bg-black/10" />
          <div className="h-11 w-11 animate-pulse rounded-full bg-black/10" />
        </div>

        <div className="mt-6 h-8 w-2/3 animate-pulse rounded-2xl bg-black/10" />
        <div className="mt-3 h-4 w-1/3 animate-pulse rounded-full bg-black/10" />

        <div className="mt-6 grid grid-cols-3 gap-1">
          {Array.from({ length: 9 }).map((_, i) => (
            <div
              key={i}
              className="aspect-square animate-pulse rounded-lg bg-black/10"
            />
          ))}
        </div>
      </div>
    </main>
  )
}
