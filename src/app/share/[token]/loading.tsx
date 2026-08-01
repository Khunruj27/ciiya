export default function SharePageLoading() {
  return (
    <main className="min-h-screen bg-[#F5F5F7] px-4 pt-10 pb-16 text-black">
      <div className="mx-auto w-full max-w-2xl">
        <div className="h-6 w-40 animate-pulse rounded-full bg-black/10" />
        <div className="mt-3 h-9 w-2/3 animate-pulse rounded-2xl bg-black/10" />
        <div className="mt-2 h-4 w-1/2 animate-pulse rounded-full bg-black/10" />

        <div className="mt-8 grid grid-cols-3 gap-1 sm:grid-cols-4 md:grid-cols-5">
          {Array.from({ length: 15 }).map((_, i) => (
            <div
              key={i}
              className="aspect-square animate-pulse rounded-md bg-black/10"
            />
          ))}
        </div>
      </div>
    </main>
  )
}
