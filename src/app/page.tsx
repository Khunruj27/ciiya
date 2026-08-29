import Image from 'next/image'
import Link from 'next/link'

const SCENES = [
  'radial-gradient(circle at 64% 18%,rgba(238,216,169,.95),transparent 18%),radial-gradient(circle at 36% 62%,rgba(198,143,119,.8),transparent 28%),linear-gradient(145deg,#4b4035,#151513 76%)',
  'radial-gradient(circle at 28% 30%,rgba(231,197,152,.9),transparent 17%),radial-gradient(circle at 70% 68%,rgba(120,145,132,.72),transparent 26%),linear-gradient(145deg,#806856,#252923 78%)',
  'radial-gradient(circle at 68% 30%,rgba(201,172,108,.82),transparent 19%),linear-gradient(125deg,#1a1a18 20%,#5d4932 52%,#171715 84%)',
  'radial-gradient(circle at 38% 28%,rgba(232,211,180,.9),transparent 19%),radial-gradient(circle at 72% 76%,rgba(142,98,82,.75),transparent 25%),linear-gradient(150deg,#96836d,#302b27 78%)',
  'radial-gradient(circle at 34% 70%,rgba(194,164,103,.7),transparent 28%),linear-gradient(145deg,#2d3033,#747d80 52%,#1b1c1d)',
  'radial-gradient(circle at 65% 24%,rgba(237,218,185,.88),transparent 16%),linear-gradient(135deg,#6e5548,#b48368 45%,#30231f)',
]

const FEATURES = [
  ['01', 'A polished gallery in minutes', 'Upload a complete shoot, keep every file organized, and deliver a client-ready gallery from one calm workspace.', 'upload'],
  ['02', 'One link. Nothing to explain.', 'Clients open the gallery without an account, choose favorites, and download exactly what you allow.', 'link'],
  ['03', 'Every guest finds their photos', 'Face search helps people discover the frames they appear in without scrolling through the whole event.', 'face'],
]

const WORKFLOW = [
  ['01', 'Create a job', 'Name the shoot and choose a cover.'],
  ['02', 'Upload once', 'Ciiya prepares the gallery while you keep working.'],
  ['03', 'Share beautifully', 'Send one link and let the work speak for itself.'],
]

const LANDING_PLANS = [
  {
    name: 'Free',
    storage: '5 GB',
    price: 'Free',
    period: 'Forever',
    description: 'A simple place to begin sharing smaller shoots.',
    features: ['Client galleries', 'Original-quality downloads', 'Portfolio page'],
  },
  {
    name: 'Starter',
    storage: '20 GB',
    price: '฿299',
    period: 'per month',
    description: 'For photographers delivering work throughout the month.',
    features: ['Everything in Free', 'More gallery storage', 'Face search for guests'],
  },
  {
    name: 'Pro',
    storage: '50 GB',
    price: '฿499',
    period: 'per month',
    description: 'Balanced storage for regular client and event work.',
    features: ['Everything in Starter', 'Guest Moments', 'Ideal for active professionals'],
    featured: true,
  },
  {
    name: 'Business',
    storage: '100 GB',
    price: '฿699',
    period: 'per month',
    description: 'More room for studios and teams with a growing archive.',
    features: ['Everything in Pro', 'High-volume storage', 'Built for studio workflows'],
  },
]

export default function HomePage() {
  return (
    <main data-accent="gold" className="min-h-dvh overflow-x-hidden bg-ground text-ink">
      <header className="sticky top-0 z-50 border-b border-line/70 bg-ground/85 backdrop-blur-xl">
        <div className="mx-auto flex h-[68px] w-full max-w-[1440px] items-center justify-between px-5 sm:px-8 lg:px-12">
          <Link href="/" aria-label="Ciiya home" className="shrink-0">
            <Image src="/logo-usage.svg" alt="Ciiya" width={126} height={46} priority className="h-8 w-auto" />
          </Link>
          <nav className="hidden items-center gap-7 text-[12px] font-medium text-muted md:flex" aria-label="Main navigation">
            <a href="#features" className="transition hover:text-ink">Features</a>
            <a href="#workflow" className="transition hover:text-ink">How it works</a>
            <a href="#portfolio" className="transition hover:text-ink">Portfolio</a>
            <a href="#pricing" className="transition hover:text-ink">Pricing</a>
          </nav>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <Link href="/login" className="flex h-10 items-center rounded-full px-3.5 text-[12px] font-semibold transition hover:bg-surface sm:px-5 sm:text-[13px]">Sign in</Link>
            <Link href="/signup" className="group flex h-10 items-center gap-2 rounded-full bg-ink px-4 text-[12px] font-semibold text-white transition hover:bg-ink-soft sm:px-5 sm:text-[13px]">
              Start free <ArrowIcon className="hidden h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 sm:block" />
            </Link>
          </div>
        </div>
      </header>

      <section className="relative isolate border-b border-line">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_75%_12%,rgba(199,168,107,0.2),transparent_30%),linear-gradient(to_bottom,#f8f6f1,#f4f0e8)]" />
        <div className="mx-auto grid min-h-[calc(100svh-68px)] w-full max-w-[1440px] items-center gap-10 px-5 py-10 sm:px-8 sm:py-14 lg:grid-cols-[0.84fr_1.16fr] lg:gap-12 lg:px-12 lg:py-16">
          <div className="relative z-10 max-w-[650px]">
            <div className="inline-flex items-center gap-2.5 rounded-full border border-line bg-surface/80 px-3.5 py-2 text-[11px] font-semibold text-muted shadow-card backdrop-blur">
              <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold opacity-50" /><span className="relative inline-flex h-2 w-2 rounded-full bg-gold" /></span>
              Built for photographers who care about delivery
            </div>
            <h1 className="pf-display mt-6 text-[clamp(3rem,7.2vw,6.8rem)] leading-[0.94] text-balance">
              Your photos<br />deserve a better<br /><span className="text-[var(--pf-accent-deep)]">way to arrive.</span>
            </h1>
            <p className="mt-6 max-w-[590px] text-[16px] font-normal leading-8 text-muted sm:text-[18px] sm:leading-9">
              From upload to final download, Ciiya gives every shoot a refined gallery, an effortless client experience, and a portfolio ready for the next inquiry.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/signup" className="group flex h-13 items-center justify-center gap-3 rounded-full bg-ink px-7 text-[14px] font-semibold text-white transition hover:-translate-y-0.5 hover:bg-ink-soft">
                Create your first gallery <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <a href="#workflow" className="flex h-13 items-center justify-center rounded-full border border-line-strong bg-surface/80 px-7 text-[14px] font-semibold transition hover:border-ink/25">See how it works</a>
            </div>
            <div className="mt-9 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] font-medium text-muted">
              <TrustItem label="Start for free" /><TrustItem label="No credit card" /><TrustItem label="Private by design" />
            </div>
          </div>
          <HeroGallery />
        </div>

        <div className="border-t border-line bg-surface/60">
          <div className="mx-auto grid w-full max-w-[1440px] grid-cols-2 divide-x divide-line px-5 sm:grid-cols-4 sm:px-8 lg:px-12">
            {[
              ['Original files', 'kept safely'], ['One link', 'for every delivery'], ['Face search', 'for every guest'], ['12 templates', 'for your portfolio'],
            ].map(([title, detail]) => (
              <div key={title} className="px-3 py-4 sm:px-6 sm:py-5 first:pl-0">
                <p className="text-[13px] font-semibold sm:text-[14px]">{title}</p><p className="mt-0.5 text-[10px] text-muted sm:text-[11px]">{detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="scroll-mt-20 bg-surface py-20 sm:py-28">
        <div className="mx-auto w-full max-w-[1440px] px-5 sm:px-8 lg:px-12">
          <SectionIntro eyebrow="One considered workspace" title="Less admin. More time behind the camera." body="Ciiya removes the awkward steps between finishing a shoot and making a client feel looked after." />
          <div className="mt-12 grid gap-4 lg:grid-cols-3">
            {FEATURES.map(([number, title, body, icon], index) => (
              <article key={number} className={`group relative overflow-hidden rounded-hero border border-line p-6 transition duration-500 hover:-translate-y-1 hover:shadow-lift sm:p-8 ${index === 1 ? 'bg-ink text-white' : 'bg-ground'}`}>
                <div className="flex items-center justify-between">
                  <span className={`text-[10px] font-semibold tracking-[0.16em] ${index === 1 ? 'text-white/40' : 'text-gold-deep'}`}>{number}</span>
                  <span className={`grid h-11 w-11 place-items-center rounded-full ${index === 1 ? 'bg-white/10 text-gold' : 'bg-gold-soft text-gold-deep'}`}><FeatureIcon name={icon} /></span>
                </div>
                <div className={`relative mt-14 overflow-hidden rounded-panel ${index === 1 ? 'bg-white/[0.06]' : 'border border-line bg-surface'}`}>
                  {index === 0 ? <UploadVisual /> : index === 1 ? <ShareVisual /> : <FaceVisual />}
                </div>
                <h3 className="mt-7 text-[22px] font-semibold leading-tight">{title}</h3>
                <p className={`mt-3 text-[14px] font-normal leading-7 ${index === 1 ? 'text-white/55' : 'text-muted'}`}>{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="workflow" className="scroll-mt-20 bg-ink px-4 py-5 text-white sm:px-6 sm:py-7">
        <div className="relative mx-auto w-full max-w-[1400px] overflow-hidden rounded-hero border border-white/10 bg-[#1d1d1a] px-5 py-16 sm:px-10 sm:py-20 lg:px-16">
          <div aria-hidden className="absolute -right-32 -top-40 h-96 w-96 rounded-full bg-gold opacity-[0.12] blur-3xl" />
          <div className="relative grid gap-12 lg:grid-cols-[0.72fr_1.28fr] lg:gap-20">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gold">A shorter path to delivered</p>
              <h2 className="pf-display mt-5 text-[clamp(2.5rem,6vw,4.8rem)]">From card to client in three calm steps.</h2>
              <p className="mt-5 max-w-md text-[14px] font-normal leading-7 text-white/50">No complex publishing flow. No separate gallery builder. The actions you need stay in one place.</p>
            </div>
            <ol className="divide-y divide-white/12 border-y border-white/12">
              {WORKFLOW.map(([number, title, detail]) => (
                <li key={number} className="group grid grid-cols-[42px_1fr_auto] items-center gap-3 py-6 sm:grid-cols-[54px_1fr_auto] sm:gap-5 sm:py-7">
                  <span className="text-[11px] font-semibold text-gold">{number}</span><div><h3 className="text-[18px] font-semibold sm:text-[21px]">{title}</h3><p className="mt-1 text-[12px] text-white/45 sm:text-[13px]">{detail}</p></div><ArrowIcon className="h-4 w-4 text-white/25 transition group-hover:translate-x-1 group-hover:text-gold" />
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section id="portfolio" className="scroll-mt-20 py-20 sm:py-28">
        <div className="mx-auto w-full max-w-[1440px] px-5 sm:px-8 lg:px-12">
          <div className="grid items-end gap-8 lg:grid-cols-[1fr_auto]">
            <SectionIntro eyebrow="Portfolio, included" title="A shopfront as considered as the work." body="Choose a distinctive template, arrange your strongest images, and share a portfolio under your own Ciiya link." />
            <Link href="/signup" className="group inline-flex h-12 w-fit items-center gap-3 rounded-full border border-line-strong bg-surface px-6 text-[13px] font-semibold transition hover:border-ink/30">Build your portfolio <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" /></Link>
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <TemplateCard name="Luxe Wedding" mood="Romantic · Refined" type="luxe" scene={0} />
            <TemplateCard name="Portrait Focus" mood="Graceful · Characterful" type="portrait" scene={1} />
            <TemplateCard name="Photo Journal" mood="Genuine · Narrative" type="journal" scene={3} />
            <TemplateCard name="Noir Atelier" mood="Dark · Exclusive" type="noir" scene={4} />
          </div>
        </div>
      </section>

      <section id="pricing" className="scroll-mt-20 border-y border-line bg-surface py-20 sm:py-28">
        <div className="mx-auto w-full max-w-[1440px] px-5 sm:px-8 lg:px-12">
          <div className="grid items-end gap-8 lg:grid-cols-[1fr_auto]">
            <SectionIntro eyebrow="Simple pricing" title="Space that grows with every story." body="Compare every Ciiya plan at a glance. The gallery experience stays polished at every level—only the available storage changes." />
            <div className="w-fit rounded-full border border-line bg-ground px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">Plan information</div>
          </div>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {LANDING_PLANS.map((plan) => (
              <article key={plan.name} className={`relative flex min-h-[430px] flex-col overflow-hidden rounded-hero border p-6 sm:p-7 ${plan.featured ? 'border-ink bg-ink text-white shadow-lift' : 'border-line bg-ground text-ink'}`}>
                {plan.featured ? <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-gold-deep via-gold to-[#ead8ad]" /> : null}
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${plan.featured ? 'text-gold' : 'text-gold-deep'}`}>{plan.name}</p>
                    <p className="mt-3 text-[27px] font-semibold tracking-[-0.045em]">{plan.storage}</p>
                  </div>
                  {plan.featured ? <span className="rounded-full bg-gold px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-ink">Popular</span> : null}
                </div>

                <div className={`mt-8 border-y py-6 ${plan.featured ? 'border-white/12' : 'border-line'}`}>
                  <p className="text-[34px] font-semibold leading-none tracking-[-0.055em]">{plan.price}</p>
                  <p className={`mt-2 text-[10px] font-medium ${plan.featured ? 'text-white/45' : 'text-muted'}`}>{plan.period}</p>
                </div>

                <p className={`mt-6 text-[13px] font-normal leading-6 ${plan.featured ? 'text-white/58' : 'text-muted'}`}>{plan.description}</p>
                <ul className={`mt-6 space-y-3 border-t pt-6 ${plan.featured ? 'border-white/12' : 'border-line'}`}>
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-center gap-2.5 text-[11px] font-medium">
                      <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${plan.featured ? 'bg-white/10 text-gold' : 'bg-gold-soft text-gold-deep'}`}><CheckIcon /></span>
                      {feature}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>

          <div className="mt-5 flex flex-col gap-2 rounded-panel border border-line bg-ground px-5 py-4 text-[10px] leading-5 text-muted sm:flex-row sm:items-center sm:justify-between">
            <span>All plans include secure galleries, portfolio tools, and controlled client downloads.</span>
            <span className="font-semibold text-ink">Prices shown in Thai baht · billed monthly</span>
          </div>
        </div>
      </section>

      <section className="px-4 pb-5 sm:px-6 sm:pb-7">
        <div className="relative mx-auto w-full max-w-[1400px] overflow-hidden rounded-hero bg-gold-soft px-5 py-16 sm:px-10 sm:py-24 lg:px-16">
          <div aria-hidden className="absolute -right-16 -top-24 text-[18rem] font-semibold leading-none text-gold/10">C</div>
          <div className="relative mx-auto max-w-3xl text-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gold-deep">Your next delivery can feel different</p>
            <h2 className="pf-display mt-5 text-[clamp(2.6rem,7vw,5rem)]">Give the work a finish your clients remember.</h2>
            <p className="mx-auto mt-5 max-w-xl text-[15px] font-normal leading-8 text-muted">Create a gallery, upload your first shoot, and share it with confidence. Start without a credit card.</p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/signup" className="group flex h-13 w-full items-center justify-center gap-3 rounded-full bg-ink px-8 text-[14px] font-semibold text-white transition hover:bg-ink-soft sm:w-auto">Start free <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" /></Link>
              <a href="#pricing" className="flex h-13 w-full items-center justify-center rounded-full border border-gold/50 bg-surface/60 px-8 text-[14px] font-semibold sm:w-auto">View plans</a>
            </div>
          </div>
        </div>
      </section>

      <footer className="mx-auto flex w-full max-w-[1440px] flex-col gap-8 px-5 py-10 sm:px-8 lg:flex-row lg:items-end lg:justify-between lg:px-12">
        <div><Image src="/logo-usage.svg" alt="Ciiya" width={110} height={40} className="h-7 w-auto opacity-80" /><p className="mt-4 max-w-sm text-[12px] leading-6 text-muted">Beautiful delivery, thoughtful storage, and a portfolio that keeps working after the shoot is done.</p></div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-[11px] font-medium text-muted"><a href="#pricing" className="hover:text-ink">Pricing</a><Link href="/login" className="hover:text-ink">Sign in</Link><Link href="/signup" className="hover:text-ink">Create account</Link><span>© {new Date().getFullYear()} Ciiya</span></div>
      </footer>
    </main>
  )
}

function HeroGallery() {
  return (
    <div className="relative mx-auto w-full max-w-[760px] lg:mx-0">
      <div aria-hidden className="absolute -inset-10 -z-10 rounded-full bg-[radial-gradient(circle,rgba(199,168,107,0.22),transparent_66%)] blur-xl" />
      <div className="relative overflow-hidden rounded-[26px] border border-white/10 bg-ink p-3 shadow-[0_32px_90px_rgba(23,23,23,0.2)] sm:rounded-[34px] sm:p-4">
        <div className="rounded-[20px] bg-[#20201d] p-3 sm:rounded-[26px] sm:p-5">
          <div className="mb-4 flex items-center justify-between text-white">
            <div className="flex items-center gap-2.5"><span className="grid h-8 w-8 place-items-center rounded-full border border-white/20 text-[10px] font-semibold">C</span><div><p className="text-[11px] font-semibold">The Riverside</p><p className="text-[9px] text-white/40">Client gallery · Ready</p></div></div>
            <span className="rounded-full bg-gold px-3 py-1.5 text-[9px] font-semibold text-ink">Share gallery</span>
          </div>
          <div className="grid grid-cols-12 grid-rows-6 gap-1.5 sm:gap-2">
            <Scene className="col-span-7 row-span-4 min-h-[210px] sm:min-h-[300px]" scene={0} label="The vows" />
            <Scene className="col-span-5 row-span-3" scene={1} /><Scene className="col-span-5 row-span-3" scene={2} />
            <Scene className="col-span-4 row-span-2 min-h-[92px]" scene={3} /><Scene className="col-span-4 row-span-2" scene={4} /><Scene className="col-span-4 row-span-2" scene={5} />
          </div>
        </div>
      </div>
      <div className="absolute -bottom-5 left-4 flex items-center gap-3 rounded-panel border border-line bg-surface px-3.5 py-3 shadow-lift sm:-left-5 sm:px-4"><span className="grid h-9 w-9 place-items-center rounded-full bg-gold-soft text-gold-deep"><CheckIcon /></span><div><p className="text-[11px] font-semibold">Gallery delivered</p><p className="mt-0.5 text-[9px] text-muted">248 originals kept safely</p></div></div>
      <div className="absolute -right-3 top-7 hidden items-center gap-2.5 rounded-full border border-line bg-surface px-3 py-2.5 shadow-lift sm:flex"><span className="grid h-7 w-7 place-items-center rounded-full bg-ink text-white"><FaceIcon /></span><span className="pr-1 text-[10px] font-semibold">Find my photos</span></div>
    </div>
  )
}

function Scene({ className, scene, label }: { className: string; scene: number; label?: string }) {
  const position = className.includes('absolute') ? '' : 'relative'
  return <div className={`${position} overflow-hidden rounded-[10px] sm:rounded-card ${className}`} style={{ background: SCENES[scene % SCENES.length] }}><div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-white/[0.04]" /><div aria-hidden className="absolute left-[38%] top-[18%] h-[55%] w-[24%] rounded-full border border-white/10 bg-white/[0.05] blur-[1px]" />{label ? <span className="absolute bottom-3 left-3 text-[10px] font-medium text-white/80 sm:bottom-4 sm:left-4 sm:text-[11px]">{label}</span> : null}</div>
}

function SectionIntro({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return <div className="max-w-3xl"><div className="flex items-center gap-4"><span className="pf-eyebrow">{eyebrow}</span><span className="pf-rule hidden max-w-28 flex-1 sm:block" aria-hidden /></div><h2 className="pf-display mt-5 text-[clamp(2.35rem,5.5vw,4.2rem)]">{title}</h2><p className="mt-5 max-w-2xl text-[15px] leading-8 text-muted sm:text-[16px]">{body}</p></div>
}

function TemplateCard({ name, mood, type, scene }: { name: string; mood: string; type: 'luxe' | 'portrait' | 'journal' | 'noir'; scene: number }) {
  const dark = type === 'noir'
  return (
    <article className={`group overflow-hidden rounded-hero border transition duration-500 hover:-translate-y-1 hover:shadow-lift ${dark ? 'border-ink bg-ink text-white' : 'border-line bg-surface'}`}>
      <div className={`relative aspect-[4/5] overflow-hidden p-3 ${type === 'luxe' ? 'bg-[#eee6d8]' : type === 'portrait' ? 'bg-[#e8e3da]' : type === 'journal' ? 'bg-[#f2ece1]' : 'bg-[#11110f]'}`}>
        {type === 'luxe' ? <><div className="absolute inset-[9%_18%_24%_10%] rounded-t-full border border-gold/45" /><Scene scene={scene} className="absolute inset-[13%_11%_19%_17%]" /><p className="absolute bottom-[7%] left-[17%] text-[14px] font-semibold">Forever, framed.</p></>
          : type === 'portrait' ? <><Scene scene={scene} className="absolute inset-[8%_18%_18%_29%] rounded-t-full" /><p className="absolute bottom-[7%] left-[8%] max-w-28 text-[18px] font-semibold leading-tight">Portraits with presence.</p></>
          : type === 'journal' ? <><div className="absolute left-[7%] top-[8%] w-[42%] rounded-card border border-line bg-[#fffdf8] p-3"><p className="text-[8px] tracking-[0.15em] text-gold-deep">FIELD NOTES / 01</p><p className="mt-5 text-[16px] font-semibold leading-tight">A day worth remembering.</p></div><Scene scene={scene} className="absolute bottom-[8%] right-[7%] top-[8%] w-[42%]" /></>
          : <><Scene scene={scene} className="absolute inset-[8%_8%_30%] grayscale" /><div className="absolute inset-x-[8%] bottom-[7%] border border-white/20 p-3"><p className="text-[8px] tracking-[0.15em] text-gold">ATELIER / 01</p><p className="mt-2 text-[18px] font-semibold">Selected work.</p></div></>}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-current/10 px-5 py-4"><div><h3 className="text-[14px] font-semibold">{name}</h3><p className={`mt-1 text-[10px] ${dark ? 'text-white/45' : 'text-muted'}`}>{mood}</p></div><span className={`grid h-8 w-8 place-items-center rounded-full transition group-hover:translate-x-0.5 ${dark ? 'bg-white/10 text-gold' : 'bg-ground-sunken text-gold-deep'}`}><ArrowIcon className="h-3.5 w-3.5" /></span></div>
    </article>
  )
}

function UploadVisual() {
  return <div className="p-5"><div className="flex items-center justify-between"><span className="text-[10px] font-semibold">Wedding selects</span><span className="text-[9px] text-muted">186 / 248</span></div><div className="mt-4 h-1.5 overflow-hidden rounded-full bg-ground-sunken"><div className="h-full w-3/4 rounded-full bg-gold" /></div><div className="mt-5 grid grid-cols-4 gap-1.5">{[0,1,2,3].map((item)=><Scene key={item} scene={item} className="aspect-square" />)}</div></div>
}

function ShareVisual() {
  return <div className="p-5"><p className="text-[9px] uppercase tracking-[0.15em] text-white/40">Gallery link</p><div className="mt-3 flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] p-1.5 pl-3"><span className="min-w-0 flex-1 truncate text-[9px] text-white/55">ciiya.app/share/the-riverside</span><span className="rounded-full bg-gold px-3 py-2 text-[9px] font-semibold text-ink">Copy</span></div><div className="mt-5 flex items-center justify-between border-t border-white/10 pt-4"><span className="text-[10px] font-medium">Downloads allowed</span><span className="h-5 w-9 rounded-full bg-gold p-0.5"><span className="ml-auto block h-4 w-4 rounded-full bg-white" /></span></div></div>
}

function FaceVisual() {
  return <div className="p-5"><div className="flex items-center gap-3"><span className="grid h-12 w-12 place-items-center rounded-full bg-ink text-white"><FaceIcon /></span><div><p className="text-[11px] font-semibold">Find every photo of you</p><p className="mt-1 text-[9px] text-muted">Upload one clear selfie</p></div></div><div className="mt-5 grid grid-cols-5 gap-1">{[0,1,2,3,4].map((item)=><Scene key={item} scene={item+1} className="aspect-[3/4] rounded-full" />)}</div></div>
}

function TrustItem({ label }: { label: string }) {
  return <span className="inline-flex items-center gap-1.5"><span className="grid h-4 w-4 place-items-center rounded-full bg-gold-soft text-gold-deep"><CheckIcon /></span>{label}</span>
}

function FeatureIcon({ name }: { name: string }) {
  if (name === 'upload') return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden><path d="M12 16V4m0 0 4 4m-4-4L8 8M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>
  if (name === 'link') return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden><path d="M9 15l6-6M11 6l1-1a4 4 0 0 1 6 6l-1 1M13 18l-1 1a4 4 0 0 1-6-6l1-1" /></svg>
  return <FaceIcon className="h-5 w-5" />
}

function ArrowIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
}

function CheckIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-2.5 w-2.5"><path d="m7 12 3 3 7-7" /></svg>
}

function FaceIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}><circle cx="12" cy="9" r="3.5" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0M4 7V4h3M20 7V4h-3" /></svg>
}
