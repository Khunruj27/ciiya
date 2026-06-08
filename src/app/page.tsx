import Link from 'next/link'
import Image from 'next/image'

export default function HomePage() {
  return (
    <main className="min-h-dvh overflow-hidden bg-[#FAF7F4] text-[#1C0617]">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -top-24 left-1/2 h-[360px] w-[360px] -translate-x-1/2 rounded-full bg-[#F0B1DE]/45 blur-3xl" />
        <div className="absolute bottom-[-120px] right-[-140px] h-[340px] w-[340px] rounded-full bg-[#D0F578]/50 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-dvh w-full max-w-[393px] flex-col px-5 pt-[max(52px,env(safe-area-inset-top))] pb-[max(28px,env(safe-area-inset-bottom))]">
        <header className="flex items-center justify-between">
          <Image
            src="/logo-usage.svg"
            alt="Ciiya Logo"
            width={120}
            height={40}
            priority
            className="h-9 w-auto"
          />

          <Link
            href="/login"
            className="flex h-11 items-center justify-center rounded-full border border-black/5 bg-white/80 px-5 text-[13px] font-black text-[#1C0617] backdrop-blur-xl transition active:scale-95"
          >
            Login
          </Link>
        </header>

        <section className="flex flex-1 flex-col justify-center py-8">
          <div className="mb-5 px-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-black/5 bg-white/70 px-3 py-2 backdrop-blur-xl">
              <span className="h-2.5 w-2.5 rounded-full bg-[#F0B1DE]" />
              <span className="text-[12px] font-black uppercase tracking-[0.16em] text-[#8E8E93]">
                Ciiya Gallery
              </span>
            </div>

            <h1 className="mt-6 text-[52px] font-black leading-[0.86] tracking-[-0.08em] text-[#1C0617]">
              Share
              <br />
              photos
              <br />
              beautifully.
            </h1>

            <p className="mt-4 max-w-[310px] text-[15px] font-semibold leading-6 text-[#8E8E93]">
              Create albums, upload photos, and share beautiful galleries with
              your clients.
            </p>
          </div>

          <div className="overflow-hidden rounded-[38px] border border-black/5 bg-white/90 p-4 backdrop-blur-xl">
            <div className="rounded-[30px] bg-[#F0B1DE] p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[13px] font-black text-[#1C0617]">
                  <span className="h-3 w-3 rounded-full bg-white" />
                  Event Gallery
                </div>

                <span className="rounded-full bg-white/70 px-3 py-1 text-[11px] font-black text-[#1C0617]">
                  2026
                </span>
              </div>

              <div className="mt-8 grid grid-cols-3 gap-1.5">
                <div className="aspect-[3/4] rounded-[18px] bg-white/50" />
                <div className="aspect-[3/4] rounded-[18px] bg-[#D0F578]" />
                <div className="aspect-[3/4] rounded-[18px] bg-white/60" />
              </div>
            </div>

            <div className="mt-4 grid gap-3">
              <Link
                href="/login"
                className="flex h-14 items-center justify-center rounded-full border border-black/5 bg-[#1C0617] px-6 text-[15px] font-black text-white transition active:scale-[0.98]"
              >
                Log in
              </Link>

              <Link
                href="/signup"
                className="flex h-14 items-center justify-center rounded-full border border-black/5 bg-[#D0F578] px-6 text-[15px] font-black text-[#1C0617] transition active:scale-[0.98]"
              >
                Create account
              </Link>
            </div>
          </div>
        </section>

        <footer className="text-center">
          <p className="text-xs font-semibold text-[#8E8E93]">
            © 2026 Ciiya. Photo sharing platform
          </p>
        </footer>
      </div>
    </main>
  )
}