import Image from 'next/image'
import Link from 'next/link'
import { getServerDictionary } from '@/lib/i18n-server'
import type { Dictionary } from '@/lib/i18n'
import LanguageSwitch from '@/components/language-switch'

const FEATURE_META = [
  { number: '01', image: '/landing/feature-upload.webp', imagePosition: 'center 48%', type: 'upload' as const },
  { number: '02', image: '/landing/feature-share.webp', imagePosition: 'center 43%', type: 'share' as const },
  { number: '03', image: '/landing/feature-face-search.webp', imagePosition: 'center 40%', type: 'face' as const },
]

const PLAN_META = [
  { name: 'Free', storage: '5 GB', price: 'Free', featured: false },
  { name: 'Starter', storage: '20 GB', price: '฿299', featured: false },
  { name: 'Pro', storage: '50 GB', price: '฿499', featured: true },
  { name: 'Business', storage: '100 GB', price: '฿699', featured: false },
]

const TILE_META = [
  { className: 'min-h-[520px] lg:col-span-7 lg:row-span-2', image: '/landing/editorial-couple.webp', imagePosition: 'center 42%', number: '01', dark: false },
  { className: 'min-h-[360px] lg:col-span-5', image: '/landing/editorial-bride.webp', imagePosition: 'center 32%', number: '02', dark: false },
  { className: 'min-h-[360px] lg:col-span-5', image: '/landing/editorial-reception.webp', imagePosition: 'center 48%', number: '03', dark: true },
]

const STEP_META = [
  { number: '01', icon: 'folder' as const, image: '/landing/editorial-couple.webp', imagePosition: 'center 40%' },
  { number: '02', icon: 'upload' as const, image: '/landing/feature-upload.webp', imagePosition: 'center 48%' },
  { number: '03', icon: 'link' as const, image: '/landing/feature-share.webp', imagePosition: 'center 42%' },
]

export default async function HomePage() {
  const { locale, t } = await getServerDictionary()
  const L = t.landing

  const features = FEATURE_META.map((meta, i) => ({ ...meta, ...L.features.items[i] }))
  const plans = PLAN_META.map((meta, i) => ({
    ...meta,
    period: i === 0 ? (locale === 'th' ? 'ตลอดไป' : 'Forever') : (locale === 'th' ? '/ เดือน' : '/ month'),
    price: meta.price === 'Free' ? (locale === 'th' ? 'ฟรี' : 'Free') : meta.price,
    ...L.pricing.plans[i],
  }))
  const tiles = TILE_META.map((meta, i) => ({ ...meta, ...L.portfolioSec.tiles[i] }))
  const steps = STEP_META.map((meta, i) => ({ ...meta, ...L.workflow.steps[i] }))

  return (
    <main data-accent="gold" className="min-h-dvh overflow-x-hidden bg-ground text-ink">
      <header className="sticky top-0 z-50 border-b border-line/70 bg-ground/90 backdrop-blur-xl">
        <div className="mx-auto flex h-[72px] w-full max-w-[1480px] items-center justify-between px-5 sm:px-8 lg:px-12">
          <Link href="/" aria-label="Ciiya home" className="shrink-0"><Image src="/logo-usage.svg" alt="Ciiya" width={126} height={46} priority className="h-8 w-auto" /></Link>
          <nav className="hidden items-center gap-8 text-[11px] font-semibold text-muted md:flex" aria-label="Main navigation">
            <a href="#features" className="transition hover:text-ink">{L.nav.features}</a><a href="#workflow" className="transition hover:text-ink">{L.nav.howItWorks}</a><a href="#portfolio" className="transition hover:text-ink">{L.nav.portfolio}</a><a href="#pricing" className="transition hover:text-ink">{L.nav.pricing}</a>
          </nav>
          <div className="flex items-center gap-1.5"><LanguageSwitch current={locale} className="mr-1" /><Link href="/login" className="flex h-10 items-center rounded-full px-3 text-[11px] font-semibold transition hover:bg-surface sm:px-5 sm:text-[12px]">{L.nav.signIn}</Link><Link href="/signup" className="flex h-10 items-center gap-2 rounded-full bg-ink px-4 text-[11px] font-semibold text-white transition hover:bg-ink-soft sm:px-5 sm:text-[12px]">{L.nav.startFree} <ArrowIcon className="hidden h-3.5 w-3.5 sm:block" /></Link></div>
        </div>
      </header>

      <section className="relative isolate border-b border-line bg-[#f3efe7]">
        <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_15%_12%,rgba(255,255,255,0.85),transparent_31%),radial-gradient(circle_at_86%_75%,rgba(199,168,107,0.18),transparent_28%)]" />
        <div className="mx-auto grid min-h-[calc(100svh-72px)] w-full max-w-[1480px] items-center gap-12 px-5 py-10 sm:px-8 sm:py-14 lg:grid-cols-[0.84fr_1.16fr] lg:gap-16 lg:px-12 lg:py-16">
          <div className="relative z-10 max-w-[660px]">
            <div className="inline-flex items-center gap-2.5 rounded-full border border-line bg-white/75 px-3.5 py-2 text-[10px] font-semibold text-muted shadow-card backdrop-blur"><span className="h-2 w-2 rounded-full bg-gold shadow-[0_0_0_5px_rgba(199,168,107,0.14)]" />{L.hero.badge}</div>
            <h1 className="pf-display mt-7 text-[clamp(2.85rem,6vw,5.75rem)] leading-[0.93]">{L.hero.line1}<br />{L.hero.line2}<br /><span className="block text-gold-deep">{L.hero.line3}</span></h1>
            <p className="mt-7 max-w-[570px] text-[15px] font-normal leading-8 text-muted sm:text-[17px] sm:leading-9">{L.hero.subtitle}</p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row"><Link href="/signup" className="group flex h-13 items-center justify-center gap-3 rounded-full bg-ink px-7 text-[13px] font-semibold text-white transition hover:-translate-y-0.5 hover:bg-ink-soft">{L.hero.ctaCreate} <ArrowIcon className="h-4 w-4 transition group-hover:translate-x-0.5" /></Link><a href="#features" className="flex h-13 items-center justify-center rounded-full border border-line-strong bg-white/65 px-7 text-[13px] font-semibold transition hover:bg-white">{L.hero.explore}</a></div>
            <div className="mt-9 flex flex-wrap gap-x-5 gap-y-2 text-[10px] font-medium text-muted">{L.hero.trust.map((label) => <TrustItem key={label} label={label} />)}</div>
          </div>
          <HeroEditorial card={L.card} />
        </div>
      </section>

      <section className="border-b border-line bg-surface"><div className="mx-auto grid w-full max-w-[1480px] grid-cols-2 divide-x divide-line px-5 sm:grid-cols-4 sm:px-8 lg:px-12">{L.stats.map(([value, label]) => <div key={value} className="py-5 pl-4 first:pl-0 sm:py-6 sm:pl-7"><p className="text-[13px] font-semibold sm:text-[15px]">{value}</p><p className="mt-1 text-[9px] text-muted sm:text-[10px]">{label}</p></div>)}</div></section>

      <section id="features" className="scroll-mt-20 bg-surface py-20 sm:py-28">
        <div className="mx-auto w-full max-w-[1480px] px-5 sm:px-8 lg:px-12">
          <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-end"><p className="pf-eyebrow">{L.features.eyebrow}</p><div><h2 className="pf-display text-[clamp(2.6rem,5.7vw,5.2rem)]">{L.features.h2a}<br />{L.features.h2b}</h2><p className="mt-5 max-w-2xl text-[14px] leading-7 text-muted sm:text-[16px] sm:leading-8">{L.features.sub}</p></div></div>
          <div className="mt-14 divide-y divide-line border-y border-line sm:mt-20">{features.map((feature, index) => <FeatureChapter key={feature.number} feature={feature} reverse={index % 2 === 1} status={L.status} />)}</div>
        </div>
      </section>

      <section id="workflow" className="scroll-mt-20 bg-ink px-4 py-5 text-white sm:px-6 sm:py-7">
        <div className="relative mx-auto max-w-[1432px] overflow-hidden rounded-hero bg-[#1d1d1a] px-5 py-16 sm:px-10 sm:py-20 lg:px-16 lg:py-24"><div aria-hidden className="absolute -right-24 -top-32 h-96 w-96 rounded-full bg-gold/10 blur-3xl" /><div className="relative grid gap-14 lg:grid-cols-[0.78fr_1.22fr] lg:gap-20"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gold">{L.workflow.eyebrow}</p><h2 className="pf-display mt-5 text-[clamp(2.65rem,5.5vw,5rem)]">{L.workflow.h2}</h2><p className="mt-6 max-w-md text-[13px] leading-7 text-white/50 sm:text-[14px]">{L.workflow.sub}</p></div><ol className="grid gap-px overflow-hidden rounded-panel border border-white/10 bg-white/10 sm:grid-cols-3">{steps.map((step) => <WorkflowStep key={step.number} number={step.number} title={step.title} detail={step.detail} icon={step.icon} image={step.image} imagePosition={step.imagePosition} />)}</ol></div></div>
      </section>

      <section id="portfolio" className="scroll-mt-20 bg-ground py-20 sm:py-28">
        <div className="mx-auto w-full max-w-[1480px] px-5 sm:px-8 lg:px-12">
          <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end"><div className="max-w-4xl"><p className="pf-eyebrow">{L.portfolioSec.eyebrow}</p><h2 className="pf-display mt-5 text-[clamp(2.6rem,5.8vw,5.3rem)]">{L.portfolioSec.h2}</h2><p className="mt-5 max-w-2xl text-[14px] leading-7 text-muted sm:text-[16px] sm:leading-8">{L.portfolioSec.sub}</p></div><Link href="/signup" className="group flex h-12 w-fit items-center gap-3 rounded-full border border-line-strong bg-surface px-6 text-[12px] font-semibold transition hover:border-ink/30">{L.portfolioSec.build} <ArrowIcon className="h-4 w-4 transition group-hover:translate-x-0.5" /></Link></div>
          <div className="mt-12 grid gap-4 lg:grid-cols-12 lg:grid-rows-2">{tiles.map((tile) => <PortfolioTile key={tile.number} className={tile.className} image={tile.image} imagePosition={tile.imagePosition} name={tile.name} mood={tile.mood} number={tile.number} dark={tile.dark} />)}</div>
        </div>
      </section>

      <section id="pricing" className="scroll-mt-20 border-y border-line bg-surface py-20 sm:py-28">
        <div className="mx-auto w-full max-w-[1480px] px-5 sm:px-8 lg:px-12"><div className="max-w-4xl"><p className="pf-eyebrow">{L.pricing.eyebrow}</p><h2 className="pf-display mt-5 text-[clamp(2.6rem,5.5vw,5rem)]">{L.pricing.h2}</h2><p className="mt-5 max-w-2xl text-[14px] leading-7 text-muted sm:text-[16px] sm:leading-8">{L.pricing.sub}</p></div><div className="mt-12 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{plans.map((plan) => <PlanCard key={plan.name} plan={plan} popular={L.pricing.popular} />)}</div><div className="mt-5 flex flex-col gap-1.5 rounded-panel border border-line bg-ground px-5 py-4 text-[10px] leading-5 text-muted sm:flex-row sm:items-center sm:justify-between"><span>{L.pricing.included}</span><span className="font-semibold text-ink">{L.pricing.pricesNote}</span></div></div>
      </section>

      <section className="bg-ground px-4 py-5 sm:px-6 sm:py-7"><div className="relative mx-auto min-h-[620px] max-w-[1432px] overflow-hidden rounded-hero bg-ink text-white"><Image src="/landing/editorial-walk.webp" alt={L.features.items[1].imageAlt} fill sizes="(max-width: 1024px) 100vw, 92vw" className="object-cover" style={{ objectPosition: 'center 38%' }} /><div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/55 to-black/10" /><div className="relative flex min-h-[620px] max-w-3xl flex-col justify-end px-6 py-12 sm:px-10 sm:py-16 lg:px-16"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gold">{L.cta.eyebrow}</p><h2 className="pf-display mt-5 text-[clamp(2.8rem,6.5vw,6rem)]">{L.cta.h2}</h2><p className="mt-6 max-w-xl text-[14px] leading-7 text-white/65 sm:text-[16px] sm:leading-8">{L.cta.sub}</p><Link href="/signup" className="group mt-8 flex h-13 w-fit items-center gap-3 rounded-full bg-white px-7 text-[13px] font-semibold text-ink transition hover:bg-gold-soft">{L.cta.startFree} <ArrowIcon className="h-4 w-4 transition group-hover:translate-x-0.5" /></Link></div></div></section>

      <footer className="mx-auto flex w-full max-w-[1480px] flex-col gap-8 px-5 py-10 sm:px-8 lg:flex-row lg:items-end lg:justify-between lg:px-12"><div><Image src="/logo-usage.svg" alt="Ciiya" width={110} height={40} className="h-7 w-auto opacity-80" /><p className="mt-4 max-w-sm text-[11px] leading-6 text-muted">{L.footer.tagline}</p></div><div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-[10px] font-medium text-muted"><a href="#features" className="hover:text-ink">{L.footer.features}</a><a href="#pricing" className="hover:text-ink">{L.footer.pricing}</a><Link href="/login" className="hover:text-ink">{L.footer.signIn}</Link><Link href="/signup" className="hover:text-ink">{L.footer.createAccount}</Link><span>© {new Date().getFullYear()} Ciiya</span></div></footer>
    </main>
  )
}

function HeroEditorial({ card }: { card: Dictionary['landing']['card'] }) {
  return <div className="relative mx-auto w-full max-w-[740px] pb-8 sm:pb-10 lg:mx-0"><div className="relative aspect-[4/5] overflow-hidden rounded-[32px] border border-white/50 bg-ink shadow-[0_34px_90px_rgba(23,23,23,0.2)] sm:min-h-[640px] sm:rounded-[38px] lg:aspect-auto lg:h-[calc(100svh-180px)] lg:min-h-[620px] lg:max-h-[760px]"><Image src="/landing/editorial-walk.webp" alt={card.dayWorthKeeping} fill priority sizes="(max-width: 1024px) 92vw, 52vw" className="object-cover" style={{ objectPosition: 'center 38%' }} /><div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/15" /><div className="absolute inset-x-4 top-4 flex items-center justify-between text-white sm:inset-x-6 sm:top-6"><span className="rounded-full border border-white/25 bg-black/15 px-3 py-2 text-[9px] font-semibold backdrop-blur">{card.riverside}</span><span className="flex items-center gap-2 rounded-full bg-white/90 px-3 py-2 text-[9px] font-semibold text-ink"><span className="h-1.5 w-1.5 rounded-full bg-rose" />{card.readyToShare}</span></div><div className="absolute inset-x-5 bottom-6 text-white sm:inset-x-7 sm:bottom-8"><p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-gold">{card.clientGallery}</p><p className="mt-2 text-[27px] font-semibold tracking-[-0.035em] sm:text-[35px]">{card.dayWorthKeeping}</p><div className="mt-5 flex items-center justify-between border-t border-white/25 pt-4 text-[9px] text-white/65"><span>{card.originalPhotos}</span><span>{card.date}</span></div></div></div><div className="absolute -bottom-1 left-4 flex items-center gap-3 rounded-panel border border-line bg-white px-3.5 py-3 shadow-lift sm:-left-5 sm:px-4"><span className="grid h-10 w-10 place-items-center rounded-full bg-gold-soft text-gold-deep"><CheckIcon /></span><div><p className="text-[10px] font-semibold">{card.delivered}</p><p className="mt-1 text-[8px] text-muted">{card.keptSafely}</p></div></div><div className="absolute -right-4 top-[18%] hidden w-32 overflow-hidden rounded-panel border-4 border-white bg-white shadow-lift sm:block lg:-right-8"><div className="relative aspect-[4/5]"><Image src="/landing/editorial-details.webp" alt={card.detailsPreserved} fill sizes="128px" className="object-cover" /></div><p className="px-3 py-2 text-[8px] font-semibold">{card.detailsPreserved}</p></div></div>
}

function FeatureChapter({ feature, reverse, status }: { feature: (typeof FEATURE_META)[number] & Dictionary['landing']['features']['items'][number]; reverse: boolean; status: Dictionary['landing']['status'] }) {
  return <article className="grid gap-8 py-12 sm:py-16 lg:grid-cols-12 lg:items-center lg:gap-14 lg:py-24"><div className={`relative overflow-hidden rounded-hero bg-ground-sunken lg:col-span-7 ${reverse ? 'lg:order-2' : ''}`}><div className="relative aspect-[4/3] sm:aspect-[16/10]"><Image src={feature.image} alt={feature.imageAlt} fill sizes="(max-width: 1024px) 92vw, 56vw" className="object-cover" style={{ objectPosition: feature.imagePosition }} /><div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" /><span className="absolute left-5 top-5 grid h-10 w-10 place-items-center rounded-full border border-white/30 bg-black/15 text-[9px] font-semibold text-white backdrop-blur">{feature.number}</span><FeatureStatus type={feature.type} status={status} /></div></div><div className={`lg:col-span-5 ${reverse ? 'lg:order-1' : ''}`}><p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-gold-deep">{feature.eyebrow}</p><h3 className="pf-display mt-4 text-[clamp(2.1rem,4.2vw,3.8rem)]">{feature.title}</h3><p className="mt-5 text-[13px] leading-7 text-muted sm:text-[15px] sm:leading-8">{feature.body}</p><ul className="mt-7 divide-y divide-line border-y border-line">{feature.points.map((point) => <li key={point} className="flex items-center gap-3 py-3.5 text-[11px] font-semibold sm:text-[12px]"><span className="grid h-5 w-5 place-items-center rounded-full bg-gold-soft text-gold-deep"><CheckIcon /></span>{point}</li>)}</ul></div></article>
}

function FeatureStatus({ type, status }: { type: 'upload' | 'share' | 'face'; status: Dictionary['landing']['status'] }) {
  if (type === 'upload') return <div className="absolute inset-x-4 bottom-4 rounded-panel border border-white/20 bg-black/35 p-4 text-white backdrop-blur-md sm:inset-x-auto sm:bottom-6 sm:left-6 sm:w-72"><div className="flex items-center justify-between text-[9px] font-semibold"><span>{status.preparingGallery}</span><span>75%</span></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/20"><div className="h-full w-3/4 rounded-full bg-gold" /></div><p className="mt-2 text-[8px] text-white/55">{status.originals}</p></div>
  if (type === 'share') return <div className="absolute inset-x-4 bottom-4 flex items-center gap-2 rounded-full border border-white/20 bg-black/35 p-1.5 pl-4 text-white backdrop-blur-md sm:inset-x-auto sm:bottom-6 sm:left-6 sm:w-80"><span className="min-w-0 flex-1 truncate text-[8px] text-white/70">ciiya.app/share/the-riverside</span><span className="rounded-full bg-gold px-4 py-2 text-[8px] font-semibold text-ink">{status.linkCopied}</span></div>
  return <div className="absolute bottom-4 left-4 flex items-center gap-2.5 rounded-full border border-white/20 bg-black/35 py-2 pl-2 pr-4 text-white backdrop-blur-md sm:bottom-6 sm:left-6"><span className="grid h-9 w-9 place-items-center rounded-full bg-gold text-ink"><FaceIcon /></span><div><p className="text-[9px] font-semibold">{status.matches}</p><p className="mt-0.5 text-[8px] text-white/55">{status.readyInSeconds}</p></div></div>
}

function WorkflowStep({ number, title, detail, icon, image, imagePosition }: { number: string; title: string; detail: string; icon: 'folder' | 'upload' | 'link'; image: string; imagePosition: string }) {
  return <li className="flex min-h-64 flex-col bg-[#1d1d1a] p-5 sm:min-h-72 sm:p-6"><div className="flex items-center justify-between"><span className="text-[9px] font-semibold text-gold">{number}</span><span className="grid h-10 w-10 place-items-center rounded-full bg-white/[0.07] text-gold"><StepIcon name={icon} /></span></div><div className="relative mt-6 aspect-[4/3] overflow-hidden rounded-card bg-white/[0.05]"><Image src={image} alt="" fill sizes="(max-width: 640px) 82vw, (max-width: 1024px) 28vw, 20vw" className="object-cover transition duration-700 hover:scale-[1.025]" style={{ objectPosition: imagePosition }} /><div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" /></div><div className="mt-auto pt-6"><h3 className="text-[18px] font-semibold">{title}</h3><p className="mt-3 text-[11px] leading-6 text-white/45">{detail}</p></div></li>
}

function PortfolioTile({ className, image, imagePosition, name, mood, number, dark = false }: { className: string; image: string; imagePosition: string; name: string; mood: string; number: string; dark?: boolean }) {
  return <article className={`group relative overflow-hidden rounded-hero ${className}`}><Image src={image} alt={name} fill sizes="(max-width: 1024px) 92vw, 58vw" className={`object-cover transition duration-700 group-hover:scale-[1.025] ${dark ? 'grayscale' : ''}`} style={{ objectPosition: imagePosition }} /><div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" /><span className="absolute left-5 top-5 grid h-9 w-9 place-items-center rounded-full border border-white/25 bg-black/10 text-[9px] font-semibold text-white backdrop-blur">{number}</span><div className="absolute inset-x-5 bottom-5 flex items-end justify-between gap-4 text-white sm:inset-x-7 sm:bottom-7"><div><p className="text-[10px] text-white/55">{mood}</p><h3 className="mt-2 text-[22px] font-semibold sm:text-[28px]">{name}</h3></div><span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-ink transition group-hover:translate-x-1"><ArrowIcon className="h-4 w-4" /></span></div></article>
}

function PlanCard({ plan, popular }: { plan: (typeof PLAN_META)[number] & { period: string } & Dictionary['landing']['pricing']['plans'][number]; popular: string }) {
  return <article className={`relative flex min-h-[390px] flex-col rounded-hero border p-6 sm:p-7 ${plan.featured ? 'border-ink bg-ink text-white shadow-lift' : 'border-line bg-ground'}`}>{plan.featured ? <span className="absolute right-5 top-5 rounded-full bg-gold px-3 py-1.5 text-[8px] font-semibold uppercase tracking-[0.12em] text-ink">{popular}</span> : null}<p className={`text-[9px] font-semibold uppercase tracking-[0.16em] ${plan.featured ? 'text-gold' : 'text-gold-deep'}`}>{plan.name}</p><p className="mt-3 text-[28px] font-semibold tracking-[-0.04em]">{plan.storage}</p><div className={`mt-7 border-y py-5 ${plan.featured ? 'border-white/12' : 'border-line'}`}><span className="text-[31px] font-semibold tracking-[-0.05em]">{plan.price}</span><span className={`ml-2 text-[9px] ${plan.featured ? 'text-white/45' : 'text-muted'}`}>{plan.period}</span></div><p className={`mt-5 text-[11px] ${plan.featured ? 'text-white/55' : 'text-muted'}`}>{plan.detail}</p><ul className={`mt-auto space-y-3 border-t pt-5 ${plan.featured ? 'border-white/12' : 'border-line'}`}>{plan.features.map((item) => <li key={item} className="flex items-center gap-2.5 text-[10px] font-medium"><span className={`grid h-5 w-5 place-items-center rounded-full ${plan.featured ? 'bg-white/10 text-gold' : 'bg-gold-soft text-gold-deep'}`}><CheckIcon /></span>{item}</li>)}</ul></article>
}

function TrustItem({ label }: { label: string }) { return <span className="inline-flex items-center gap-1.5"><span className="grid h-4 w-4 place-items-center rounded-full bg-gold-soft text-gold-deep"><CheckIcon /></span>{label}</span> }
function ArrowIcon({ className = 'h-4 w-4' }: { className?: string }) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}><path d="M5 12h14M13 6l6 6-6 6" /></svg> }
function CheckIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-2.5 w-2.5"><path d="m7 12 3 3 7-7" /></svg> }
function FaceIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-4 w-4"><circle cx="12" cy="9" r="3.5" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0M4 7V4h3M20 7V4h-3" /></svg> }
function StepIcon({ name }: { name: 'folder' | 'upload' | 'link' }) {
  if (name === 'folder') return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-4 w-4"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z" /></svg>
  if (name === 'upload') return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-4 w-4"><path d="M12 16V4m0 0 4 4m-4-4L8 8M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-4 w-4"><path d="M9 15l6-6M11 6l1-1a4 4 0 0 1 6 6l-1 1M13 18l-1 1a4 4 0 0 1-6-6l1-1" /></svg>
}
