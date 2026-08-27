import Link from 'next/link'
import Image from 'next/image'

export default function HomePage() {
  return (
    <main className="min-h-dvh overflow-hidden bg-ground text-ink">
      <header className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-between px-5 pb-4 pt-[max(24px,env(safe-area-inset-top))] sm:px-8 lg:px-12">
        <Image src="/logo-usage.svg" alt="Ciiya" width={132} height={48} priority className="h-9 w-auto sm:h-10" />
        <div className="flex items-center gap-2">
          <Link href="/login" className="flex h-11 items-center rounded-control border border-line bg-surface px-4 text-sm font-medium transition hover:border-line-strong sm:px-5">Sign in</Link>
          <Link href="/signup" className="hidden h-11 items-center rounded-control bg-ink px-5 text-sm font-medium text-white transition hover:bg-ink-soft sm:flex">Get started</Link>
        </div>
      </header>

      <section className="relative mx-auto grid w-full max-w-7xl items-center gap-10 px-5 pb-16 pt-8 sm:px-8 sm:pt-14 lg:min-h-[calc(100dvh-92px)] lg:grid-cols-[0.9fr_1.1fr] lg:gap-16 lg:px-12 lg:pb-24 lg:pt-8">
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-2 text-xs font-medium text-muted shadow-card">
            <span className="h-2 w-2 rounded-full bg-gold" />A space for every important moment
          </div>
          <h1 className="mt-6 text-[clamp(2.65rem,8vw,5.75rem)] font-semibold leading-[0.96] tracking-[-0.055em] text-balance">Keep your important photos<br />beautiful and secure</h1>
          <p className="mt-5 max-w-xl text-base font-normal leading-7 text-muted sm:text-lg sm:leading-8">Upload, store, share, and download photos from every job with ease, in a gallery designed to make your work shine</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/signup" className="flex h-13 items-center justify-center rounded-control bg-ink px-6 text-sm font-medium text-white transition hover:bg-ink-soft sm:min-w-40">Start storing photos</Link>
            <Link href="/login" className="flex h-13 items-center justify-center rounded-control border border-line bg-surface px-6 text-sm font-medium transition hover:border-line-strong sm:min-w-40">View my jobs</Link>
          </div>
          <div className="mt-9 grid max-w-xl grid-cols-3 divide-x divide-line border-y border-line py-4 text-sm">
            <div className="pr-3"><p className="font-semibold">Secure</p><p className="mt-1 text-xs text-muted">Your data stays private</p></div>
            <div className="px-3"><p className="font-semibold">Easy to share</p><p className="mt-1 text-xs text-muted">Open instantly</p></div>
            <div className="pl-3"><p className="font-semibold">Sharp photos</p><p className="mt-1 text-xs text-muted">Keep the originals</p></div>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-[660px] lg:mx-0">
          <div className="absolute -inset-16 -z-10 bg-[radial-gradient(circle,rgba(199,168,107,0.2),transparent_65%)]" />
          <div className="rounded-[28px] border border-line bg-surface p-3 shadow-[0_18px_60px_rgba(23,23,23,0.08)] sm:rounded-[36px] sm:p-4">
            <div className="relative aspect-[4/5] overflow-hidden rounded-[20px] bg-ink sm:aspect-[5/4] sm:rounded-[28px]">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,#c7a86b_0%,#6e5b3c_20%,#343434_52%,#171717_100%)]" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/15" />
              <div className="absolute left-5 right-5 top-5 flex items-center justify-between text-white sm:left-7 sm:right-7 sm:top-7">
                <span className="rounded-full border border-white/20 bg-black/15 px-3 py-2 text-xs backdrop-blur-md">Ciiya Gallery</span>
                <span className="rounded-full bg-gold px-3 py-2 text-xs font-medium text-ink">Ready to share</span>
              </div>
              <div className="absolute bottom-0 left-0 right-0 p-5 text-white sm:p-8">
                <p className="text-xs uppercase tracking-[0.18em] text-white/60">Recent Jobs</p>
                <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em] sm:text-5xl">Every memory<br />in one place</h2>
                <div className="mt-5 grid grid-cols-3 gap-2">
                  {[1, 2, 3].map((item) => <div key={item} className="aspect-[4/3] rounded-card border border-white/15 bg-white/10 backdrop-blur-sm" />)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
