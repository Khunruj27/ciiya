import Link from 'next/link'

const plans = [
  { name: 'Free', storage: '5GB', price: '฿0' },
  { name: 'Starter', storage: '20GB', price: '฿199/mo' },
  { name: 'Pro', storage: '50GB', price: '฿399/mo' },
  { name: 'Studio', storage: '200GB', price: '฿499/mo' },
  { name: 'Business', storage: '500GB', price: '฿699/mo' },
]

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#f6f7fb] text-slate-900">
      <section className="px-5 py-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="text-2xl font-bold">Racky</div>

          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="rounded-full bg-white px-5 py-2 text-sm font-medium shadow-sm ring-1 ring-black/5"
            >
              Login
            </Link>

            <Link
              href="/signup"
              className="rounded-full bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-sm"
            >
              Get Started
            </Link>
          </div>
        </div>
      </section>

      <section className="px-5 pb-16 pt-10">
        <div className="mx-auto max-w-5xl">
          <div className="rounded-[40px] bg-white p-8 shadow-sm ring-1 ring-black/5 md:p-14">
            <p className="text-xs uppercase tracking-[0.3em] text-blue-600">
              Photo Sharing Platform
            </p>

            <h1 className="mt-5 max-w-3xl text-5xl font-bold leading-tight md:text-7xl">
              Share event photos beautifully and instantly.
            </h1>

            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-500">
              Racky helps photographers create albums, upload photos, generate
              QR codes, and share galleries with clients in real time.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/signup"
                className="rounded-full bg-blue-600 px-7 py-4 font-medium text-white shadow-sm"
              >
                Start Free
              </Link>

              <Link
                href="/pricing"
                className="rounded-full bg-slate-100 px-7 py-4 font-medium text-slate-700"
              >
                View Pricing
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="px-5 pb-16">
        <div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-3">
          {[
            ['Instant Upload', 'Upload JPG photos and organize them by album.'],
            ['Share with QR', 'Generate public gallery links and QR codes.'],
            ['Live Gallery', 'Clients can view new photos and trending images.'],
          ].map(([title, desc]) => (
            <div
              key={title}
              className="rounded-[32px] bg-white p-6 shadow-sm ring-1 ring-black/5"
            >
              <h2 className="text-xl font-bold">{title}</h2>
              <p className="mt-3 text-sm leading-6 text-slate-500">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="px-5 pb-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-3xl font-bold">Pricing</h2>
          <p className="mt-2 text-slate-500">
            Flexible storage plans for photographers and studios.
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-5">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-black/5"
              >
                <h3 className="font-bold">{plan.name}</h3>
                <p className="mt-2 text-sm text-slate-500">{plan.storage}</p>
                <p className="mt-4 text-2xl font-bold">{plan.price}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 pb-20">
        <div className="mx-auto max-w-5xl rounded-[36px] bg-slate-900 p-8 text-white md:p-12">
          <h2 className="text-3xl font-bold">
            Built for photographers, studios, and event teams.
          </h2>
          <p className="mt-4 max-w-2xl text-white/70">
            Racky is designed for wedding, event, school, and studio photo
            delivery workflows.
          </p>

          <div className="mt-8">
            <Link
              href="/signup"
              className="rounded-full bg-white px-7 py-4 font-medium text-slate-900"
            >
              Create Account
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white px-5 py-8">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 text-sm text-slate-500 md:flex-row md:items-center md:justify-between">
          <p>© 2026 Racky. Photo sharing platform.</p>
          <p>Support: khunruj27@gmail.com</p>
        </div>
      </footer>
    </main>
  )
}