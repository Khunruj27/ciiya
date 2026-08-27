export default function PublicPortfolioLoading() {
  return (
    <main className="min-h-screen animate-pulse bg-ground">
      <div className="min-h-[88svh] bg-ground-sunken" />
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="h-3 w-28 rounded-full bg-line-strong" />
        <div className="mt-5 h-12 w-64 max-w-full rounded-card bg-line" />
        <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((item) => (
            <div key={item} className="aspect-[4/5] rounded-panel bg-ground-sunken" />
          ))}
        </div>
      </div>
    </main>
  )
}
