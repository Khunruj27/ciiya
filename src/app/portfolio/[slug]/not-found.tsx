import Link from 'next/link'

export default function PortfolioNotFound() {
  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-ground px-6 text-center text-ink">
      <div aria-hidden className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-gold-soft blur-3xl" />
      <div className="relative max-w-lg">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-line bg-surface text-[15px] font-semibold shadow-card">C</span>
        <p className="mt-8 text-[10px] font-medium uppercase tracking-[0.22em] text-gold-deep">Portfolio unavailable</p>
        <h1 className="pf-display mt-4 text-[clamp(2.6rem,10vw,5rem)]">Portfolio not found</h1>
        <p className="mx-auto mt-5 max-w-md text-[14px] leading-[1.8] text-muted">The link may have changed, been unpublished, or isn’t ready to view</p>
        <Link href="/" className="mt-8 inline-flex h-12 items-center rounded-full bg-ink px-7 text-[13px] font-semibold text-white transition active:scale-95">Back to home</Link>
      </div>
    </main>
  )
}
