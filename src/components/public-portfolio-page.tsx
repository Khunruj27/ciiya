import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { getServerDictionary } from '@/lib/i18n-server'
import PortfolioGallery from '@/components/portfolio-gallery'
import PortfolioTemplateHero from '@/components/portfolio-template-hero'
import { templateUsesDarkHero } from '@/lib/portfolio-templates'
import {
  getPortfolioBySlug,
  getOwnPortfolioPreview,
} from '@/lib/portfolio-data'
import {
  displayHandle,
  facebookUrl,
  instagramUrl,
  lineUrl,
  telUrl,
  tiktokUrl,
  websiteUrl,
} from '@/lib/portfolio-links'

type PageProps = {
  params: Promise<{ slug: string }>
}

export const revalidate = 60

export async function generateMetadata({
  params,
}: Pick<PageProps, 'params'>): Promise<Metadata> {
  const { slug } = await params
  let view = await getPortfolioBySlug(slug)
  let ownerPreview = false

  if (!view) {
    view = await getOwnPortfolioPreview(slug)
    ownerPreview = Boolean(view)
  }

  if (!view) return { title: 'Portfolio not found · Ciiya' }

  const name = view.portfolio.display_name || 'Photographer'
  const description =
    view.portfolio.tagline ||
    view.portfolio.bio?.slice(0, 150) ||
    `Photography by ${name}`

  return {
    title: `${name} · Photography`,
    description,
    robots: ownerPreview ? { index: false, follow: false } : undefined,
    openGraph: {
      title: `${name} · Photography`,
      description,
      images:
        view.portfolio.hero_photo_url || view.portfolio.gallery_urls?.[0]
          ? [view.portfolio.hero_photo_url || view.portfolio.gallery_urls[0]]
          : undefined,
    },
  }
}

export default async function PublicPortfolioPage({
  params,
}: PageProps) {
  const { slug } = await params

  let view = await getPortfolioBySlug(slug)
  let isPreview = false

  /*
   * An owner can open the same clean URL before publishing. If the public
   * read finds nothing, the cookie-scoped read lets only that portfolio's
   * owner see it; everyone else still gets a 404.
   */
  if (!view) {
    view = await getOwnPortfolioPreview(slug)
    isPreview = Boolean(view)
  }

  if (!view) notFound()

  const { portfolio, showcase } = view
  const { t } = await getServerDictionary()

  const name = portfolio.display_name || t.portfolioPublic.defaultName

  // The hero falls back through what the page actually has, so a portfolio
  // published before a hero was picked still opens on a photograph.
  const heroUrl =
    portfolio.hero_photo_url ||
    showcase[0] ||
    null

  // Only an explicitly uploaded cover is removed from the gallery. When the
  // first gallery image doubles as the fallback cover it still belongs in the
  // gallery, because the owner added it there intentionally.
  const strip = showcase
    .filter((url) => !portfolio.hero_photo_url || url !== portfolio.hero_photo_url)
    .slice(0, 12)

  const layout = portfolio.layout
  const galleryLayout = portfolio.gallery_layout || 'carousel'
  const heroShell =
    layout === 'stack'
      ? 'min-h-[100svh]'
      : layout === 'grid'
        ? 'min-h-[78svh] sm:m-6 sm:min-h-[calc(100svh-3rem)] sm:rounded-hero'
        : layout === 'masonry'
          ? 'min-h-[82svh] sm:min-h-[88svh]'
          : layout === 'minimal'
            ? 'min-h-[72svh] sm:m-8 sm:min-h-[calc(100svh-4rem)] sm:rounded-hero'
            : layout === 'split'
              ? 'min-h-[84svh] sm:m-6 sm:min-h-[calc(100svh-3rem)] sm:rounded-hero'
              : layout === 'classic'
                ? 'min-h-[88svh] sm:min-h-[94svh]'
                : layout === 'bold'
                  ? 'min-h-[94svh]'
                  : layout === 'luxe'
                    ? 'min-h-[92svh] sm:m-5 sm:min-h-[calc(100svh-2.5rem)] sm:rounded-hero'
                    : layout === 'portrait'
                      ? 'min-h-[90svh] sm:min-h-[96svh]'
                      : layout === 'journal'
                        ? 'min-h-[90svh] sm:m-5 sm:min-h-[calc(100svh-2.5rem)] sm:rounded-hero'
                        : layout === 'noir'
                          ? 'min-h-[94svh]'
          : 'min-h-[86svh] sm:min-h-[92svh]'
  const heroUsesLightText = templateUsesDarkHero(layout)
  const heroImages = [heroUrl, ...showcase.filter((url) => url !== heroUrl)].filter(Boolean) as string[]
  const isNoir = layout === 'noir'
  const isLuxe = layout === 'luxe'
  const isJournal = layout === 'journal'
  const isPortrait = layout === 'portrait'
  const galleryTitle = isLuxe
    ? t.portfolioPublic.galleryTitleLuxe
    : isPortrait
      ? t.portfolioPublic.galleryTitlePortrait
      : isJournal
        ? t.portfolioPublic.galleryTitleJournal
        : isNoir
          ? t.portfolioPublic.galleryTitleNoir
          : t.portfolioPublic.galleryTitleDefault
  const galleryShell = isNoir
    ? 'border-white/10 bg-[#121210] text-white shadow-none'
    : isLuxe
      ? 'border-[#d9cdb9] bg-[#f5efe5]'
      : isJournal
        ? 'border-[#d8cdbd] bg-[#eee7db]'
        : 'border-line bg-surface shadow-[0_-18px_50px_rgba(23,21,18,0.04)]'
  const aboutShell = isNoir
    ? 'border-white/10 bg-[#1a1a17] text-white'
    : isLuxe
      ? 'border-[#d9cdb9] bg-[#eee4d5]'
      : isJournal
        ? 'border-[#d8cdbd] bg-[#f8f3e9]'
        : 'border-line bg-[var(--pf-accent-soft)]'
  const aboutHeadingTone = isNoir ? 'text-white' : 'text-ink'
  const aboutBodyTone = isNoir ? 'text-white/65' : 'text-ink-soft'
  const contactShell = isNoir
    ? 'rounded-[8px] border border-white/12 bg-[#0f0f0e] shadow-none sm:rounded-[16px]'
    : isLuxe
      ? 'rounded-[40px] bg-[#493b30] shadow-[0_24px_70px_rgba(73,59,48,0.2)] sm:rounded-[56px]'
      : isJournal
        ? 'rounded-[18px] border border-[#4b493e] bg-[#302f29] shadow-[0_24px_60px_rgba(23,21,18,0.14)]'
        : 'rounded-[32px] bg-ink shadow-[0_24px_60px_rgba(23,21,18,0.18)]'
  const contactLayout = isLuxe
    ? 'relative space-y-10 text-center'
    : 'relative grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16'
  const contactCard = isNoir
    ? 'rounded-[4px] border-white/15 bg-transparent hover:border-[var(--pf-accent)]/60 hover:bg-white/[0.04]'
    : isLuxe
      ? 'rounded-full border-white/15 bg-white/[0.07] px-5 hover:border-white/30 hover:bg-white/[0.1]'
      : isJournal
        ? 'rounded-[10px] border-white/12 bg-white/[0.045] hover:bg-white/[0.08]'
        : 'rounded-panel border-white/12 bg-white/[0.05] hover:border-white/25 hover:bg-white/[0.08]'

  const contacts = [
    portfolio.contact_line && portfolio.show_contact_line !== false && {
      key: 'line',
      label: 'LINE',
      value: displayHandle(portfolio.contact_line),
      href: lineUrl(portfolio.contact_line),
    },
    portfolio.contact_phone && portfolio.show_contact_phone !== false && {
      key: 'phone',
      label: t.portfolioPublic.contactPhone,
      value: portfolio.contact_phone,
      href: telUrl(portfolio.contact_phone),
    },
    portfolio.contact_facebook && portfolio.show_contact_facebook !== false && {
      key: 'facebook',
      label: 'Facebook',
      value: displayHandle(portfolio.contact_facebook),
      href: facebookUrl(portfolio.contact_facebook),
    },
    portfolio.contact_instagram && portfolio.show_contact_instagram !== false && {
      key: 'instagram',
      label: 'Instagram',
      value: displayHandle(portfolio.contact_instagram),
      href: instagramUrl(portfolio.contact_instagram),
    },
    portfolio.contact_tiktok && portfolio.show_contact_tiktok !== false && {
      key: 'tiktok',
      label: 'TikTok',
      value: displayHandle(portfolio.contact_tiktok),
      href: tiktokUrl(portfolio.contact_tiktok),
    },
    portfolio.contact_email && portfolio.show_contact_email !== false && {
      key: 'email',
      label: t.portfolioPublic.contactEmail,
      value: portfolio.contact_email,
      href: `mailto:${portfolio.contact_email}`,
    },
    portfolio.contact_website && portfolio.show_contact_website !== false && {
      key: 'website',
      label: t.portfolioPublic.contactWebsite,
      value: displayHandle(portfolio.contact_website),
      href: websiteUrl(portfolio.contact_website),
    },
  ].filter(Boolean) as {
    key: string
    label: string
    value: string
    href: string
  }[]

  const primaryContact = contacts[0]

  return (
    <main
      data-accent={portfolio.accent}
      data-template={layout}
      className="min-h-screen bg-ground text-ink"
    >
      {isPreview ? (
        <div className="sticky top-0 z-50 flex items-center justify-center gap-3 bg-ink px-4 py-2.5 text-center text-[12px] font-medium text-white">
          {t.portfolioPublic.previewBanner}
          <Link
            href="/portfolio"
            className="shrink-0 rounded-full bg-white/15 px-3 py-1 font-semibold"
          >
            {t.portfolioPublic.backToEditing}
          </Link>
        </div>
      ) : null}

      <section className={`relative isolate overflow-hidden ${heroShell}`}>
        <PortfolioTemplateHero
          layout={layout}
          name={name}
          tagline={portfolio.tagline}
          location={portfolio.location}
          images={heroImages}
          className="absolute inset-0"
          actions={
            <div className={`flex flex-wrap gap-2.5 ${layout === 'minimal' || layout === 'classic' ? 'justify-center' : ''}`}>
              {primaryContact ? (
                <a
                  href={primaryContact.href}
                  target={primaryContact.href.startsWith('http') ? '_blank' : undefined}
                  rel={primaryContact.href.startsWith('http') ? 'noreferrer noopener' : undefined}
                  className={`inline-flex h-12 w-full items-center justify-center gap-2.5 rounded-full px-5 text-[14px] font-semibold transition active:scale-[0.97] sm:w-auto sm:px-6 ${heroUsesLightText ? 'bg-white text-ink' : 'bg-ink text-white'}`}
                >
                  {t.portfolioPublic.getInTouch}
                  <ArrowIcon />
                </a>
              ) : null}
              {strip.length > 0 ? (
                <a href="#gallery" className={`inline-flex h-12 w-full items-center justify-center rounded-full border px-5 text-[14px] font-semibold transition active:scale-[0.97] sm:w-auto sm:px-6 ${heroUsesLightText ? 'border-white/35 bg-black/10 text-white' : 'border-ink/20 bg-white/55 text-ink backdrop-blur'}`}>
                  {t.portfolioPublic.viewGallery}
                </a>
              ) : null}
            </div>
          }
        />

        <div className="absolute inset-x-0 top-0 z-10 px-5 pt-[max(20px,env(safe-area-inset-top))] sm:px-10 lg:px-16">
          <div className={`mx-auto flex w-full max-w-6xl items-center justify-between ${heroUsesLightText ? 'text-white' : 'text-ink'}`}>
            <Link href="/" className={`inline-flex items-center gap-2.5 rounded-full px-2 py-1.5 backdrop-blur ${heroUsesLightText ? 'bg-black/10' : 'bg-white/55'}`} aria-label="Ciiya">
              <span className={`grid h-9 w-9 place-items-center rounded-full border text-[12px] font-semibold ${heroUsesLightText ? 'border-white/30' : 'border-ink/15'}`}>C</span>
              <span className="pr-2 text-[12px] font-semibold uppercase tracking-[0.2em]">Ciiya Portfolio</span>
            </Link>

            <nav className={`hidden items-center gap-6 rounded-full border px-5 py-2.5 text-[11px] font-medium backdrop-blur-md sm:flex ${heroUsesLightText ? 'border-white/25 bg-black/10' : 'border-ink/10 bg-white/65'}`} aria-label={t.portfolioPublic.portfolioMenu}>
              {strip.length > 0 ? <a href="#gallery" className="transition hover:opacity-60">{t.portfolioPublic.menuGallery}</a> : null}
              {portfolio.bio ? <a href="#about" className="transition hover:opacity-60">{t.portfolioPublic.menuAbout}</a> : null}
              {contacts.length > 0 ? <a href="#contact" className="transition hover:opacity-60">{t.portfolioPublic.menuContact}</a> : null}
            </nav>

            {primaryContact ? <a href="#contact" className={`rounded-full border px-4 py-2 text-[12px] font-semibold backdrop-blur-md transition active:scale-95 sm:hidden ${heroUsesLightText ? 'border-white/30 bg-black/10' : 'border-ink/10 bg-white/65'}`}>{t.portfolioPublic.menuContact}</a> : null}
          </div>
        </div>
      </section>

      <div className={`sticky z-40 hidden border-b border-line/80 bg-ground/90 backdrop-blur-xl lg:block ${isPreview ? 'top-[41px]' : 'top-0'}`}>
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-16">
          <a href="#" className="pf-display text-[20px] font-semibold" aria-label={t.portfolioPublic.backToTop}>
            {name}
          </a>
          <nav className="flex items-center gap-8 text-[12px] font-medium text-ink-soft" aria-label={t.portfolioPublic.mainMenu}>
            {strip.length > 0 ? <a href="#gallery" className="transition hover:text-[var(--pf-accent-deep)]">{t.portfolioPublic.menuGallery}</a> : null}
            {portfolio.bio ? <a href="#about" className="transition hover:text-[var(--pf-accent-deep)]">{t.portfolioPublic.menuAbout}</a> : null}
            {contacts.length > 0 ? <a href="#contact" className="rounded-full bg-ink px-5 py-2.5 text-white transition hover:bg-ink-soft">{t.portfolioPublic.getInTouch}</a> : null}
          </nav>
        </div>
      </div>

      {strip.length > 0 ? (
        <section id="gallery" className={`mt-10 scroll-mt-8 rounded-t-[36px] border-y py-16 sm:mt-16 sm:rounded-t-[48px] sm:py-24 ${galleryShell}`}>
          <header className="mx-auto mb-8 w-full max-w-6xl px-6 sm:mb-12 sm:px-10 lg:px-16">
            <div className="flex items-center gap-4">
              <span className="pf-eyebrow tabular-nums">01</span>
              <span className="pf-rule flex-1" aria-hidden />
              <span className="pf-eyebrow">{t.portfolioPublic.selectedShots}</span>
            </div>
            <div className="mt-6 flex items-end justify-between gap-6">
              <h2 className="pf-display text-[clamp(2.4rem,6.5vw,4.2rem)]">{galleryTitle}</h2>
              <p className={`hidden max-w-xs text-right text-[13px] leading-relaxed sm:block ${isNoir ? 'text-white/45' : 'text-muted'}`}>{t.portfolioPublic.tapToFullScreen}<br />{t.portfolioPublic.useArrowKeys}</p>
            </div>
          </header>
          <div className={galleryLayout === 'grid' || galleryLayout === 'masonry' || galleryLayout.startsWith('collage') ? 'mx-auto w-full max-w-6xl px-4 sm:px-8' : 'px-3 sm:px-6'}>
            <PortfolioGallery images={strip} layout={galleryLayout} ownerName={name} />
          </div>
        </section>
      ) : null}

      {/* ── ABOUT ────────────────────────────────────────────────────────
          Set in a narrow measure at a size worth reading, because this is
          the paragraph that decides whether the client writes back. */}
      {portfolio.bio ? (
        <section id="about" className="mx-auto w-full max-w-6xl scroll-mt-8 px-4 py-16 sm:px-8 sm:py-24">
          <div className={`relative overflow-hidden rounded-[32px] border px-6 py-8 sm:px-10 sm:py-12 lg:px-14 lg:py-16 ${aboutShell}`}>
            <div aria-hidden className="absolute -right-24 -top-28 h-72 w-72 rounded-full bg-white/45 blur-3xl" />
            <div className="relative mb-10 flex items-center gap-4">
              <span className="pf-eyebrow tabular-nums">02</span>
              <span className="pf-rule flex-1" aria-hidden />
              <span className="pf-eyebrow">{t.portfolioPublic.menuAbout}</span>
            </div>
            <div className="relative grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
              <div>
                <span className="pf-serif text-[54px] leading-none text-[var(--pf-accent-deep)] opacity-[0.35]" aria-hidden>“</span>
                <h2 className={`pf-display -mt-3 text-[clamp(2.2rem,5vw,3.6rem)] ${aboutHeadingTone}`}>{t.portfolioPublic.aboutHeading1}<br className="hidden sm:block" />{t.portfolioPublic.aboutHeading2}</h2>
              </div>
              <p className={`pf-serif max-w-2xl whitespace-pre-line text-[17px] font-normal leading-[1.95] sm:text-[20px] ${aboutBodyTone}`}>{portfolio.bio}</p>
            </div>
          </div>
        </section>
      ) : null}

      {/* ── CONTACT ──────────────────────────────────────────────────────
          The page's one dark surface, saved for the thing it is asking the
          visitor to do. */}
      <section id="contact" className="scroll-mt-8 px-4 pb-8 sm:px-6">
        <div className={`relative mx-auto w-full max-w-6xl overflow-hidden px-6 py-12 text-white sm:px-12 sm:py-16 lg:px-16 lg:py-20 ${contactShell}`}>
          <div aria-hidden className="absolute -right-20 -top-32 h-80 w-80 rounded-full bg-[var(--pf-accent)] opacity-[0.14] blur-3xl" />
          <div className={contactLayout}>
            <div>
              <div className={`mb-6 flex items-center gap-4 ${isLuxe ? 'justify-center' : ''}`}>
                <span className="pf-eyebrow tabular-nums" style={{ color: 'var(--pf-accent)' }}>03</span>
                <span className="h-px flex-1 bg-white/20" aria-hidden />
                <span className="pf-eyebrow" style={{ color: 'var(--pf-accent)' }}>{t.portfolioPublic.getInTouch}</span>
              </div>

              <h2 className={`pf-display max-w-xl text-[clamp(2.2rem,6vw,4.2rem)] ${isLuxe ? 'mx-auto' : ''}`}>
                {t.portfolioPublic.talkProject(name)}
              </h2>

              <p className={`mt-5 max-w-md text-[14px] font-normal leading-relaxed text-white/60 sm:text-[15px] ${isLuxe ? 'mx-auto' : ''}`}>
                {t.portfolioPublic.contactDesc}
              </p>
            </div>

            {contacts.length > 0 ? (
              <div className="grid content-start gap-2.5 sm:grid-cols-2">
              {contacts.map((contact) => (
                <a
                  key={contact.key}
                  href={contact.href}
                  target={contact.href.startsWith('http') ? '_blank' : undefined}
                  rel={
                    contact.href.startsWith('http')
                      ? 'noreferrer noopener'
                      : undefined
                  }
                  className={`group flex min-h-20 items-center gap-3.5 border px-4 py-3.5 text-left transition hover:-translate-y-0.5 active:scale-[0.99] ${contactCard}`}
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/10 text-[var(--pf-accent)]">
                    <ContactIcon name={contact.key} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/45">
                      {contact.label}
                    </p>
                    <p className="mt-1 truncate text-[15px] font-semibold">
                      {contact.value}
                    </p>
                  </div>

                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                    className="h-4 w-4 shrink-0 text-white/40 transition group-hover:text-[var(--pf-accent)]"
                  >
                    <path d="M7 17 17 7M9 7h8v8" />
                  </svg>
                </a>
              ))}
              </div>
            ) : (
              <p className="self-center text-[14px] font-normal text-white/50">
                {t.portfolioPublic.noContact}
              </p>
            )}
          </div>
        </div>
      </section>

      <footer className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 pb-[max(32px,env(safe-area-inset-bottom))] pt-4 text-[11px] text-muted">
        <p>© {new Date().getFullYear()} {name}</p>
        <Link href="/" className="font-medium tracking-[0.04em] transition hover:text-ink">{t.portfolioPublic.madeWith}</Link>
      </footer>
    </main>
  )
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-4 w-4">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

function ContactIcon({ name }: { name: string }) {
  if (name === 'phone') {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-5 w-5"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7A2 2 0 0 1 22 16.9Z" /></svg>
  }

  if (name === 'email') {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-5 w-5"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
  }

  if (name === 'website') {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-5 w-5"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></svg>
  }

  return <span className="text-[11px] font-semibold uppercase">{name === 'instagram' ? 'IG' : name === 'facebook' ? 'FB' : name === 'tiktok' ? 'TT' : name === 'line' ? 'LN' : '•'}</span>
}
