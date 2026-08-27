export default function PortfolioLoading() {
  return (
    <main className="min-h-screen bg-ground px-4 py-5 sm:px-8 lg:px-10">
      <div className="mx-auto w-full max-w-[1480px] animate-pulse">
        <div className="h-64 rounded-hero border border-line bg-surface sm:h-80" />
        <div className="mt-5 h-24 rounded-hero bg-ink/90" />
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_420px] xl:grid-cols-[minmax(0,1fr)_500px]">
          <div className="h-[520px] rounded-hero border border-line bg-surface" />
          <div className="order-first h-[620px] rounded-hero border border-line bg-surface lg:order-last" />
        </div>
      </div>
    </main>
  )
}
