import Link from 'next/link'
import Image from 'next/image'

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#EFEFF1] px-5 pt-[max(80px,env(safe-area-inset-top))] pb-[max(40px,env(safe-area-inset-bottom))] text-black">
      <div className="mx-auto flex min-h-[calc(100dvh-100px)] w-full max-w-[390px] flex-col">
        {/* HEADER */}
        <header className="flex items-center justify-between">
          <Image
            src="/logo-usage.svg"
            alt="Ciiya Logo"
            width={0}
            height={0}
            priority
            className="h-10 w-auto"
          />

          <Link
            href="/login"
            className="flex h-11 items-center justify-center rounded-full bg-white px-5 text-sm font-black text-black shadow-[0_10px_30px_rgba(15,23,42,0.06)] transition active:scale-95"
          >
            Login
          </Link>
        </header>

        {/* HERO */}
        <section className="flex flex-1 flex-col justify-center py-10">
          <div className="overflow-hidden rounded-[36px] bg-[#2F6BFF] p-6 text-white shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
            <div className="flex items-center gap-2 text-[14px] font-bold text-white/80">
              <span className="h-3 w-3 rounded-full bg-[#EFEFF1]" />
              Ciiya Gallery
            </div>

            <h1 className="mt-7 text-[46px] font-black leading-[0.9] tracking-[-0.08em]">
              Share photos beautifully.
            </h1>

            <p className="mt-5 text-[15px] font-medium leading-6 text-white/70">
              Create albums, upload photos, and share galleries with clients.
            </p>

            <div className="mt-8 grid gap-3">
              <Link
                href="/login"
                className="flex h-14 items-center justify-center rounded-full bg-white px-6 text-sm font-black text-black transition active:scale-[0.98]"
              >
                Log in
              </Link>

              <Link
                href="/signup"
                className="flex h-14 items-center justify-center rounded-full bg-white/12 px-6 text-sm font-black text-white ring-1 ring-white/15 backdrop-blur-md transition active:scale-[0.98]"
              >
                Create account
              </Link>
            </div>
          </div>
        </section>

        {/* FOOTER */}
        <footer className="text-center">
          <p className="text-xs font-medium text-slate-400">
            © 2026 Ciiya. Photo sharing platform
          </p>
        </footer>
      </div>
    </main>
  )
}