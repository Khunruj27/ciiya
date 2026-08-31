import Image from 'next/image'
import type { ReactNode } from 'react'
import type { Portfolio } from '@/lib/portfolio-types'

type Props = {
  layout: Portfolio['layout']
  name: string
  tagline?: string | null
  location?: string | null
  images: string[]
  compact?: boolean
  previewDevice?: 'mobile' | 'desktop'
  actions?: ReactNode
  className?: string
}

export default function PortfolioTemplateHero({
  layout,
  name,
  tagline,
  location,
  images,
  compact = false,
  previewDevice = 'desktop',
  actions,
  className = '',
}: Props) {
  const mobilePreview = compact && previewDevice === 'mobile'
  const photo = (index: number) =>
    images.length > 0 ? images[index % images.length] : undefined
  const pad = compact ? 'p-3' : 'px-6 pb-10 pt-24 sm:px-12 sm:pb-14 lg:px-16'
  const title = compact
    ? ['portrait', 'journal', 'noir', 'museum', 'mosaic_luxe', 'contact_sheet', 'sanctuary'].includes(layout)
      ? 'text-[clamp(12px,2.2vw,20px)]'
      : 'text-[clamp(13px,4vw,26px)]'
    : layout === 'portrait'
      ? 'text-[clamp(1.45rem,7vw,4rem)] [overflow-wrap:anywhere]'
    : ['grid', 'masonry', 'luxe', 'portrait', 'journal', 'museum', 'polaroid', 'mosaic_luxe', 'contact_sheet', 'sanctuary'].includes(layout)
      ? 'text-[clamp(1.85rem,6vw,4.5rem)] [overflow-wrap:anywhere]'
      : 'text-[clamp(2.15rem,11vw,7.5rem)] [overflow-wrap:anywhere]'
  const small = compact ? 'text-[6px] sm:text-[8px]' : 'text-[11px] sm:text-[12px]'
  const body = compact ? 'text-[6px] sm:text-[9px]' : 'text-[14px] sm:text-[17px]'

  const copy = (tone: 'light' | 'dark' = 'dark', align = '') => (
    <div className={`relative min-w-0 ${align} ${tone === 'light' ? 'text-white' : 'text-ink'}`}>
      {location ? <p className={`${small} font-medium uppercase tracking-[0.18em] ${tone === 'light' ? 'text-white/60' : 'text-[var(--pf-accent-deep)]'}`}>{location}</p> : null}
      <h1 className={`pf-display mt-2 break-words font-semibold ${title}`}>{name}</h1>
      {tagline ? <p className={`mt-3 line-clamp-3 max-w-xl font-normal leading-relaxed ${body} ${tone === 'light' ? 'text-white/65' : 'text-muted'}`}>{tagline}</p> : null}
      {actions ? <div className={compact ? 'hidden' : 'mt-7'}>{actions}</div> : null}
    </div>
  )

  if (mobilePreview) {
    return (
      <MobileTemplateHero
        layout={layout}
        name={name}
        tagline={tagline}
        location={location}
        photo={photo}
        className={className}
      />
    )
  }

  return (
    <div className={`overflow-hidden ${className}`} data-portfolio-hero={layout}>
      {layout === 'editorial' ? (
        <div className={`${compact ? mobilePreview ? 'grid grid-rows-[56%_44%] p-2' : 'grid grid-cols-[1.35fr_1fr] p-2' : 'grid grid-rows-[56%_44%] p-2 sm:grid-cols-[1.35fr_1fr] sm:grid-rows-1 sm:p-6'} h-full gap-0 bg-ground`}>
          <HeroPhoto url={photo(0)} name={name} priority={!compact} className="rounded-[10px] sm:rounded-[20px]" />
          <div className={`flex items-end ${compact ? pad : 'px-4 pb-6 pt-4 sm:px-12 sm:pb-14 sm:pt-24 lg:px-16'}`}>{copy('dark')}</div>
        </div>
      ) : layout === 'grid' ? (
        <div className={`${compact ? mobilePreview ? 'grid-cols-2 grid-rows-[auto_1fr_1fr_1fr] p-2 pt-10' : 'grid-cols-3 grid-rows-[auto_1fr_1fr] p-2' : 'grid-cols-2 grid-rows-[auto_1fr_1fr_1fr] gap-2 p-2 pt-20 sm:grid-cols-3 sm:grid-rows-[auto_1fr_1fr] sm:gap-3 sm:p-6 sm:pt-28'} grid h-full gap-1.5 bg-ground`}>
          <div className={`${compact ? mobilePreview ? 'col-span-2' : 'col-span-3' : 'col-span-2 sm:col-span-3'} flex items-end justify-between gap-4 px-1 pb-1`}>
            <div className="max-w-[75%]">{copy('dark')}</div>
            <span className="h-1 w-10 rounded-full bg-[var(--pf-accent)]" />
          </div>
          {[0, 1, 2, 3, 4, 5].map((index) => <HeroPhoto key={index} url={photo(index)} name={name} priority={!compact && index === 0} className="rounded-[6px] sm:rounded-[16px]" />)}
        </div>
      ) : layout === 'masonry' ? (
        <div className={`${compact ? mobilePreview ? 'grid-cols-2 grid-rows-4 p-2 pt-10' : 'grid-cols-3 grid-rows-3 p-2' : 'grid-cols-2 grid-rows-4 gap-2 p-2 pt-20 sm:grid-cols-3 sm:grid-rows-3 sm:gap-3 sm:p-6 sm:pt-28'} grid h-full gap-1.5 bg-ground`}>
          <HeroPhoto url={photo(0)} name={name} priority={!compact} className="row-span-2 rounded-[6px] sm:rounded-[16px]" />
          <HeroPhoto url={photo(1)} name={name} className="rounded-[6px] sm:rounded-[16px]" />
          <HeroPhoto url={photo(2)} name={name} className="row-span-2 rounded-[6px] sm:rounded-[16px]" />
          <HeroPhoto url={photo(3)} name={name} className="row-span-2 rounded-[6px] sm:rounded-[16px]" />
          <div className={`flex items-end rounded-[6px] bg-[var(--pf-accent-soft)] sm:rounded-[16px] ${compact ? mobilePreview ? 'col-span-2 p-2' : 'p-1.5' : 'col-span-2 p-3 sm:p-5'}`}>{copy('dark')}</div>
          <HeroPhoto url={photo(4)} name={name} className={`${compact && !mobilePreview ? '' : 'hidden'} rounded-[6px] sm:rounded-[16px]`} />
        </div>
      ) : layout === 'minimal' ? (
        <div className={`flex h-full flex-col items-center justify-center bg-ground text-center ${pad}`}>
          <div className="max-w-3xl">{copy('dark', 'text-center')}</div>
          <HeroPhoto url={photo(0)} name={name} priority={!compact} className={`${compact ? 'mt-3 h-[45%] w-[78%]' : 'mt-10 h-[48%] w-full max-w-4xl'} rounded-[8px] sm:rounded-[22px]`} />
        </div>
      ) : layout === 'split' ? (
        <div className={`${compact ? mobilePreview ? 'grid-rows-[55%_45%]' : 'grid-cols-2' : 'grid-rows-[55%_45%] sm:grid-cols-2 sm:grid-rows-1'} grid h-full bg-ink`}>
          <HeroPhoto url={photo(0)} name={name} priority={!compact} />
          <div className={`flex items-end ${compact ? pad : 'px-5 pb-8 pt-4 sm:px-12 sm:pb-14 sm:pt-24 lg:px-16'}`}>{copy('light')}</div>
        </div>
      ) : layout === 'classic' ? (
        <div className="relative flex h-full items-center justify-center bg-ink text-center">
          <HeroPhoto url={photo(0)} name={name} priority={!compact} className="absolute inset-0 opacity-75" />
          <div className="absolute inset-0 bg-black/35" />
          <div className={`relative max-w-4xl ${pad}`}>{copy('light', 'text-center')}</div>
        </div>
      ) : layout === 'luxe' ? (
        <div className={`relative h-full overflow-hidden bg-[#f2ede3] ${compact ? 'p-2.5' : 'px-4 pb-5 pt-20 sm:px-10 sm:pb-10 sm:pt-28 lg:px-16'}`}>
          <div className="absolute inset-x-[12%] top-0 h-px bg-[var(--pf-accent)]/55" />
          <div className={`${compact && !mobilePreview ? 'grid-cols-[0.86fr_1.14fr]' : 'grid-rows-[1.15fr_0.85fr] sm:grid-cols-[0.9fr_1.1fr] sm:grid-rows-1'} grid h-full gap-2 sm:gap-8 lg:gap-14`}>
            <div className={`relative ${compact ? 'min-h-0' : 'min-h-[42svh]'}`}>
              <div className="absolute inset-[7%_12%_0_0] rounded-[8px] border border-[var(--pf-accent)]/45 sm:rounded-[24px]" />
              <HeroPhoto url={photo(0)} name={name} priority={!compact} className="absolute inset-[0_0_7%_7%] rounded-[8px] sm:rounded-[24px]" />
              <HeroPhoto url={photo(1)} name={name} className="absolute bottom-0 right-0 h-[38%] w-[34%] rounded-[6px] border-2 border-[#f2ede3] sm:rounded-[18px] sm:border-[6px]" />
            </div>
            <div className={`relative flex flex-col justify-center ${compact ? 'px-1' : 'px-2 sm:px-0'}`}>
              <span className={`${small} mb-2 font-medium tracking-[0.16em] text-[var(--pf-accent-deep)]`}>THE SIGNATURE COLLECTION</span>
              {copy('dark')}
              <span className={`${compact ? 'mt-2 w-10' : 'mt-8 w-20'} h-px bg-[var(--pf-accent)]`} />
            </div>
          </div>
        </div>
      ) : layout === 'portrait' ? (
        <div className={`relative h-full overflow-hidden bg-[#e9e5dd] ${compact ? 'p-2.5' : 'px-4 pb-6 pt-20 sm:px-10 sm:pb-10 sm:pt-28 lg:px-16'}`}>
          <div className={`${compact && !mobilePreview ? 'grid-cols-[0.72fr_1.2fr_0.5fr]' : 'grid-cols-[0.9fr_1.1fr] grid-rows-[1fr_auto] sm:grid-cols-[0.75fr_1.25fr_0.55fr] sm:grid-rows-1'} grid h-full gap-2 sm:gap-6`}>
            <div className="flex min-w-0 flex-col justify-end border-l border-ink/15 pl-2 sm:pl-6">
              <span className={`${small} mb-auto text-muted`}>PORTRAIT<br />STUDY</span>
              {copy('dark')}
            </div>
            <HeroPhoto url={photo(0)} name={name} priority={!compact} className="rounded-t-[999px] rounded-b-[8px] sm:rounded-b-[24px]" />
            <div className={`${compact && mobilePreview ? 'col-span-2 grid grid-cols-[1fr_auto]' : ''} min-w-0`}>
              <HeroPhoto url={photo(1)} name={name} className={`${compact && mobilePreview ? 'h-full min-h-0' : 'h-[45%]'} rounded-[6px] sm:rounded-[18px]`} />
              <p className={`${small} ${compact && mobilePreview ? 'self-end px-2' : 'mt-3'} text-muted`}>SELECTED<br />PORTRAITS · 01</p>
            </div>
          </div>
        </div>
      ) : layout === 'journal' ? (
        <div className={`relative h-full overflow-hidden bg-[#f5f0e7] ${compact ? 'p-2.5' : 'px-4 pb-6 pt-20 sm:px-10 sm:pb-10 sm:pt-28 lg:px-16'}`}>
          <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(var(--ciiya-line)_1px,transparent_1px),linear-gradient(90deg,var(--ciiya-line)_1px,transparent_1px)] [background-size:32px_32px]" />
          <div className={`${compact && !mobilePreview ? 'grid-cols-[0.85fr_1.15fr]' : 'grid-rows-[auto_1fr] sm:grid-cols-[0.85fr_1.15fr] sm:grid-rows-1'} relative grid h-full gap-2 sm:gap-8`}>
            <div className="flex min-w-0 flex-col justify-between rounded-[8px] border border-ink/12 bg-[#fffdf8]/85 p-2.5 sm:rounded-[20px] sm:p-7">
              <span className={`${small} font-medium tracking-[0.15em] text-[var(--pf-accent-deep)]`}>FIELD NOTES / 01</span>
              {copy('dark')}
              <p className={`${small} text-muted`}>Photos · People · Memories</p>
            </div>
            <div className="grid min-h-0 grid-cols-[1.3fr_0.7fr] grid-rows-2 gap-1.5 sm:gap-3">
              <HeroPhoto url={photo(0)} name={name} priority={!compact} className="row-span-2 rounded-[7px] sm:rounded-[18px]" />
              <HeroPhoto url={photo(1)} name={name} className="rounded-[7px] sm:rounded-[18px]" />
              <div className="relative rounded-[7px] bg-[var(--pf-accent)] p-2 text-ink sm:rounded-[18px] sm:p-5">
                <span className={`${compact ? 'text-lg' : 'text-4xl'} pf-display`}>02</span>
                <p className={`${small} absolute bottom-2 left-2 sm:bottom-5 sm:left-5`}>MOMENTS<br />IN BETWEEN</p>
              </div>
            </div>
          </div>
        </div>
      ) : layout === 'noir' ? (
        <div className={`relative h-full overflow-hidden bg-[#11110f] text-white ${compact ? 'p-2.5' : 'px-4 pb-6 pt-20 sm:px-10 sm:pb-10 sm:pt-28 lg:px-16'}`}>
          <div className={`${compact && !mobilePreview ? 'grid-cols-[1.15fr_0.85fr]' : 'grid-rows-[1.2fr_0.8fr] sm:grid-cols-[1.18fr_0.82fr] sm:grid-rows-1'} grid h-full gap-2 sm:gap-5`}>
            <div className="relative min-h-0 overflow-hidden rounded-[7px] sm:rounded-[22px]">
              <HeroPhoto url={photo(0)} name={name} priority={!compact} className="absolute inset-0" imageClassName="grayscale contrast-110" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />
              <span className={`${small} absolute bottom-3 left-3 text-white/60 sm:bottom-6 sm:left-6`}>ATELIER / SELECTED WORK</span>
            </div>
            <div className={`flex min-w-0 flex-col justify-between border border-white/15 ${compact ? 'p-2.5' : 'p-5 sm:p-8 lg:p-10'}`}>
              <div className="flex items-center justify-between text-white/45">
                <span className={small}>Nº 01</span><span className="h-px w-10 bg-[var(--pf-accent)]" />
              </div>
              {copy('light')}
              <p className={`${small} text-white/40`}>CI I YA · PORTFOLIO</p>
            </div>
          </div>
        </div>
      ) : layout === 'monogram' ? (
        <div className={`relative h-full overflow-hidden bg-[#f3eee5] ${compact ? 'p-2.5' : 'px-5 pb-8 pt-20 sm:px-12 sm:pb-12 sm:pt-28 lg:px-20'}`}>
          <div className="absolute left-1/2 top-0 h-full w-px bg-[#bfa77b]/35" />
          <div className={`${compact && !mobilePreview ? 'grid-cols-[0.8fr_1.2fr]' : 'grid-rows-[1.2fr_0.8fr] sm:grid-cols-[0.8fr_1.2fr] sm:grid-rows-1'} relative grid h-full gap-3 sm:gap-10`}>
            <div className="flex min-w-0 flex-col justify-between border-y border-[#bfa77b]/45 py-2 sm:py-8">
              <div className={`${compact ? 'h-8 w-8 text-[10px]' : 'h-16 w-16 text-[18px]'} grid place-items-center rounded-full border border-[#bfa77b] bg-[#faf7f1] pf-display text-[#7d6742]`}>
                {name.slice(0, 1).toUpperCase()}
              </div>
              {copy('dark')}
              <p className={`${small} tracking-[0.18em] text-[#8b7652]`}>EST. MMXXVI · SELECTED WORK</p>
            </div>
            <div className="relative min-h-0">
              <div className="absolute inset-[6%_0_0_8%] rounded-t-[999px] border border-[#bfa77b]/55" />
              <HeroPhoto url={photo(0)} name={name} priority={!compact} className="absolute inset-[0_8%_6%_0] rounded-t-[999px] rounded-b-[8px] sm:rounded-b-[24px]" />
              <HeroPhoto url={photo(1)} name={name} className="absolute bottom-0 right-0 h-[34%] w-[36%] rounded-full border-2 border-[#f3eee5] sm:border-[6px]" />
            </div>
          </div>
        </div>
      ) : layout === 'horizon' ? (
        <div className="relative flex h-full flex-col bg-[#ebe8df]">
          <div className={`${compact ? 'h-[62%]' : 'h-[58%] sm:h-[68%]'} relative overflow-hidden`}>
            <HeroPhoto url={photo(0)} name={name} priority={!compact} className="absolute inset-0" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-black/10" />
            <p className={`${small} absolute left-4 top-4 tracking-[0.18em] text-white/70 sm:left-10 sm:top-8`}>HORIZON / VISUAL JOURNAL</p>
          </div>
          <div className={`${compact ? 'px-3 py-2' : 'px-6 py-6 sm:px-12 sm:py-10 lg:px-16'} flex flex-1 items-center justify-between gap-6`}>
            <div className="min-w-0 flex-1">{copy('dark')}</div>
            <div className="hidden items-center gap-2 sm:flex"><span className="h-px w-20 bg-[#8b887d]" /><span className={small}>01 / 10</span></div>
          </div>
        </div>
      ) : layout === 'museum' ? (
        <div className={`relative h-full bg-[#fbfaf7] ${compact ? 'p-3' : 'px-5 pb-8 pt-20 sm:px-12 sm:pb-12 sm:pt-28 lg:px-20'}`}>
          <div className={`${compact && !mobilePreview ? 'grid-cols-[1fr_2fr_0.65fr]' : 'grid-cols-[0.7fr_2fr] grid-rows-[1fr_auto] sm:grid-cols-[0.7fr_2fr_0.65fr] sm:grid-rows-1'} grid h-full gap-3 sm:gap-8`}>
            <div className="flex flex-col justify-between border-r border-ink/10 pr-2 sm:pr-6">
              <span className={`${small} tracking-[0.16em] text-muted`}>EXHIBITION<br />ROOM 01</span>
              <span className={`${compact ? 'text-xl' : 'text-5xl'} pf-display text-[var(--pf-accent-deep)]`}>01</span>
            </div>
            <div className="flex min-h-0 items-center justify-center bg-[#efede7] p-2 sm:p-6">
              <HeroPhoto url={photo(0)} name={name} priority={!compact} className="h-[86%] w-[82%] shadow-[0_16px_40px_rgba(20,18,14,0.14)]" />
            </div>
            <div className={`${compact && mobilePreview ? 'col-span-2' : ''} flex min-w-0 flex-col justify-end border-t border-ink/10 pt-2 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0`}>
              {copy('dark')}
            </div>
          </div>
        </div>
      ) : layout === 'polaroid' ? (
        <div className={`relative h-full overflow-hidden bg-[#d9c9b5] ${compact ? 'p-3' : 'px-5 pb-8 pt-20 sm:px-12 sm:pb-12 sm:pt-28 lg:px-20'}`}>
          <div className="absolute inset-0 opacity-20 [background-image:radial-gradient(#6f5f4c_0.8px,transparent_0.8px)] [background-size:12px_12px]" />
          <div className={`${compact && !mobilePreview ? 'grid-cols-[1.3fr_0.7fr]' : 'grid-rows-[1.35fr_0.65fr] sm:grid-cols-[1.3fr_0.7fr] sm:grid-rows-1'} relative grid h-full gap-3 sm:gap-8`}>
            <div className="relative min-h-0">
              <HeroPhoto url={photo(0)} name={name} priority={!compact} className="absolute left-[8%] top-[2%] h-[78%] w-[58%] rotate-[-4deg] border-[5px] border-white border-b-[18px] shadow-card sm:border-[10px] sm:border-b-[34px]" />
              <HeroPhoto url={photo(1)} name={name} className="absolute right-[5%] top-[18%] h-[70%] w-[52%] rotate-[5deg] border-[5px] border-white border-b-[18px] shadow-card sm:border-[10px] sm:border-b-[34px]" />
              <HeroPhoto url={photo(2)} name={name} className="absolute bottom-[2%] left-[30%] h-[45%] w-[38%] rotate-[1deg] border-4 border-white border-b-[14px] shadow-card sm:border-8 sm:border-b-[26px]" />
            </div>
            <div className="flex min-w-0 flex-col justify-end rounded-[10px] bg-[#f8f1e7]/80 p-3 backdrop-blur-sm sm:rounded-[22px] sm:p-7">
              <span className={`${small} mb-auto text-[#7d664c]`}>MEMORY DESK · 01</span>
              {copy('dark')}
            </div>
          </div>
        </div>
      ) : layout === 'duotone' ? (
        <div className={`relative h-full overflow-hidden bg-[#121212] text-white ${compact ? 'p-2.5' : 'px-4 pb-6 pt-20 sm:px-10 sm:pb-10 sm:pt-28 lg:px-16'}`}>
          <div className={`${compact ? mobilePreview ? 'grid-rows-[1fr_0.7fr]' : 'grid-cols-[1.05fr_0.95fr]' : 'grid-rows-[1fr_0.72fr] sm:grid-cols-[1.05fr_0.95fr] sm:grid-rows-1'} grid h-full gap-2 sm:gap-4`}>
            <div className="grid min-h-0 grid-cols-2 gap-1.5 sm:gap-3">
              <HeroPhoto url={photo(0)} name={name} priority={!compact} imageClassName="grayscale contrast-110" />
              <HeroPhoto url={photo(1)} name={name} imageClassName="grayscale contrast-125" />
            </div>
            <div className="flex min-w-0 flex-col justify-between bg-[var(--pf-accent)] p-3 text-ink sm:p-8 lg:p-10">
              <p className={`${small} tracking-[0.2em]`}>DUOTONE / STUDIO 01</p>
              {copy('dark')}
              <div className="flex items-center gap-3"><span className="h-px flex-1 bg-ink/40" /><span className={small}>CI I YA</span></div>
            </div>
          </div>
        </div>
      ) : layout === 'coverflow' ? (
        <div className={`relative h-full overflow-hidden bg-[#e8e5df] ${compact ? 'p-3' : 'px-4 pb-7 pt-20 sm:px-10 sm:pb-10 sm:pt-28 lg:px-16'}`}>
          <div className="absolute inset-x-0 top-[48%] h-px bg-ink/15" />
          <div className="relative flex h-full items-center justify-center gap-2 sm:gap-5">
            <HeroPhoto url={photo(1)} name={name} className="h-[48%] w-[15%] -rotate-3 rounded-[5px] opacity-55 sm:h-[62%] sm:w-[27%] sm:rounded-[14px] sm:opacity-70" />
            <div className="relative z-10 h-[84%] w-[64%] shadow-[0_20px_55px_rgba(20,18,14,0.2)] sm:h-[82%] sm:w-[42%]">
              <HeroPhoto url={photo(0)} name={name} priority={!compact} className="absolute inset-0 rounded-[6px] sm:rounded-[16px]" />
              <div className="absolute inset-0 rounded-[6px] bg-gradient-to-t from-black/70 via-transparent to-black/10 sm:rounded-[16px]" />
              <div className={`${compact ? 'p-2' : 'p-5 sm:p-8'} absolute inset-x-0 bottom-0`}>{copy('light')}</div>
            </div>
            <HeroPhoto url={photo(2)} name={name} className="h-[48%] w-[15%] rotate-3 rounded-[5px] opacity-55 sm:h-[62%] sm:w-[27%] sm:rounded-[14px] sm:opacity-70" />
          </div>
        </div>
      ) : layout === 'mosaic_luxe' ? (
        <div className={`relative h-full overflow-hidden bg-[#eee5d8] ${compact ? 'p-2.5' : 'px-4 pb-6 pt-20 sm:px-10 sm:pb-10 sm:pt-28 lg:px-16'}`}>
          <div className={`${compact ? mobilePreview ? 'grid-cols-2 grid-rows-[1.25fr_0.75fr]' : 'grid-cols-[1.2fr_0.7fr_0.9fr] grid-rows-2' : 'grid-cols-2 grid-rows-[1.25fr_0.75fr] sm:grid-cols-[1.2fr_0.7fr_0.9fr] sm:grid-rows-2'} grid h-full gap-2 sm:gap-4`}>
            <HeroPhoto url={photo(0)} name={name} priority={!compact} className={`${compact ? mobilePreview ? 'col-span-2' : 'row-span-2' : 'col-span-2 sm:col-span-1 sm:row-span-2'} rounded-[8px] sm:rounded-[22px]`} />
            <HeroPhoto url={photo(1)} name={name} className="rounded-[8px] sm:rounded-[22px]" />
            <div className="flex min-w-0 flex-col justify-end rounded-[8px] border border-[#b9a27b]/55 bg-[#f7f1e7] p-3 sm:rounded-[22px] sm:p-7">
              <span className={`${small} mb-auto text-[#8b7248]`}>LUXE COLLECTION</span>
              {copy('dark')}
            </div>
            <HeroPhoto url={photo(2)} name={name} className={`${compact && mobilePreview ? 'hidden' : 'hidden sm:block'} rounded-[8px] sm:rounded-[22px]`} />
            <HeroPhoto url={photo(3)} name={name} className={`${compact && mobilePreview ? 'hidden' : 'hidden sm:block'} rounded-[8px] sm:rounded-[22px]`} />
          </div>
        </div>
      ) : layout === 'contact_sheet' ? (
        <div className={`relative h-full overflow-hidden bg-[#151513] text-white ${compact ? 'p-2.5' : 'px-4 pb-6 pt-20 sm:px-10 sm:pb-10 sm:pt-28 lg:px-16'}`}>
          <div className="flex h-full flex-col gap-2 sm:gap-5">
            <div className="flex items-end justify-between gap-5 border-b border-white/15 pb-2 sm:pb-5">
              <div className="max-w-[72%]">{copy('light')}</div>
              <span className={`${small} text-white/45`}>ROLL 01<br />FRAME 001—006</span>
            </div>
            <div className={`${compact ? mobilePreview ? 'grid-cols-2 grid-rows-3' : 'grid-cols-3 grid-rows-2' : 'grid-cols-2 grid-rows-3 sm:grid-cols-3 sm:grid-rows-2'} grid min-h-0 flex-1 gap-1.5 sm:gap-3`}>
              {[0, 1, 2, 3, 4, 5].map((index) => (
                <div key={index} className="relative min-h-0 border border-white/10 p-1 sm:p-2">
                  <HeroPhoto url={photo(index)} name={name} priority={!compact && index === 0} className="h-full" imageClassName="grayscale" />
                  <span className="absolute bottom-1 right-1 bg-black/65 px-1 text-[5px] text-white/60 sm:bottom-2 sm:right-2 sm:text-[8px]">0{index + 1}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : layout === 'letterbox' ? (
        <div className="relative flex h-full flex-col justify-center overflow-hidden bg-black text-white">
          <div className={`${compact ? 'h-[52%]' : 'h-[66%] sm:h-[58%]'} relative w-full overflow-hidden border-y border-white/10`}>
            <HeroPhoto url={photo(0)} name={name} priority={!compact} className="absolute inset-0" />
            <div className="absolute inset-0 bg-gradient-to-r from-black/45 via-transparent to-black/35" />
            <span className={`${small} absolute left-4 top-3 tracking-[0.18em] text-white/60 sm:left-10 sm:top-6`}>A CIIYA FILM · 01</span>
          </div>
          <div className={`${compact ? 'px-3 py-2' : 'px-6 py-6 sm:px-12 sm:py-9 lg:px-16'} flex items-end justify-between gap-6`}>
            <div className="max-w-3xl">{copy('light')}</div>
            <span className={`${small} hidden text-right text-white/35 sm:block`}>WIDE SCREEN<br />SELECTED WORK</span>
          </div>
        </div>
      ) : layout === 'sanctuary' ? (
        <div className={`relative h-full overflow-hidden bg-[#f4f0e9] ${compact ? 'p-3' : 'px-5 pb-8 pt-20 sm:px-12 sm:pb-12 sm:pt-28 lg:px-20'}`}>
          <div className="absolute left-[8%] top-[12%] h-[70%] w-[70%] rounded-full bg-white/55 blur-3xl" />
          <div className={`${compact && !mobilePreview ? 'grid-cols-[1fr_1fr]' : 'grid-rows-[1.15fr_0.85fr] sm:grid-cols-[1fr_1fr] sm:grid-rows-1'} relative grid h-full gap-3 sm:gap-10`}>
            <div className="relative flex min-h-0 items-center justify-center">
              <HeroPhoto url={photo(0)} name={name} priority={!compact} className="h-[92%] w-[72%] rounded-[50%] border-[5px] border-white shadow-[0_18px_50px_rgba(91,75,55,0.14)] sm:border-[10px]" />
              <HeroPhoto url={photo(1)} name={name} className="absolute bottom-[2%] right-[2%] h-[34%] w-[34%] rounded-full border-4 border-[#f4f0e9] sm:border-8" />
            </div>
            <div className="flex min-w-0 flex-col items-center justify-center text-center">
              <span className={`${small} mb-3 tracking-[0.2em] text-[var(--pf-accent-deep)]`}>A SOFT PLACE FOR MEMORIES</span>
              {copy('dark', 'text-center')}
              <span className={`${compact ? 'mt-3 w-10' : 'mt-8 w-20'} h-px bg-[var(--pf-accent)]`} />
            </div>
          </div>
        </div>
      ) : layout === 'bold' ? (
        <div className={`${compact ? mobilePreview ? 'grid-rows-[1fr_1.2fr] p-3 pt-10' : 'grid-cols-[1.2fr_0.8fr] p-3' : 'grid-rows-[1fr_1.2fr] gap-3 p-4 pt-20 sm:grid-cols-[1.2fr_0.8fr] sm:grid-rows-1 sm:gap-6 sm:p-12 sm:pt-28 lg:p-16 lg:pt-32'} grid h-full gap-2 bg-[var(--pf-accent)]`}>
          <div className="flex min-w-0 flex-col justify-end">{copy('dark')}</div>
          <HeroPhoto url={photo(0)} name={name} priority={!compact} className="rounded-[7px] sm:rounded-[22px]" />
        </div>
      ) : (
        <div className="relative flex h-full items-end bg-ink">
          <HeroPhoto url={photo(0)} name={name} priority={!compact} className="absolute inset-0" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/15 to-black/15" />
          <div className={`relative w-full ${pad}`}>{copy('light')}</div>
        </div>
      )}
    </div>
  )
}

function MobileTemplateHero({
  layout,
  name,
  tagline,
  location,
  photo,
  className,
}: {
  layout: Portfolio['layout']
  name: string
  tagline?: string | null
  location?: string | null
  photo: (index: number) => string | undefined
  className: string
}) {
  const dark = ['stack', 'classic', 'noir', 'duotone', 'contact_sheet', 'letterbox'].includes(layout)
  const collage = ['grid', 'masonry', 'luxe', 'journal', 'polaroid', 'mosaic_luxe', 'contact_sheet'].includes(layout)
  const minimal = ['minimal', 'museum', 'horizon', 'sanctuary'].includes(layout)
  const creator = ['bold', 'coverflow', 'duotone'].includes(layout)
  const roundImage = ['portrait', 'monogram', 'sanctuary'].includes(layout)

  const mobileCopy = (tone: 'light' | 'dark' = dark ? 'light' : 'dark', centered = false) => (
    <div className={`min-w-0 ${centered ? 'text-center' : ''} ${tone === 'light' ? 'text-white' : 'text-ink'}`}>
      {location ? <p className={`text-[clamp(5px,2.7cqw,9px)] font-medium uppercase tracking-[0.16em] ${tone === 'light' ? 'text-white/55' : 'text-[var(--pf-accent-deep)]'}`}>{location}</p> : null}
      <h1 className="pf-display mt-[3cqw] text-[clamp(10px,7cqw,23px)] font-semibold leading-[1.02] tracking-[-0.04em] [overflow-wrap:anywhere]">{name}</h1>
      {tagline ? <p className={`mt-[3cqw] line-clamp-2 text-[clamp(5px,3.2cqw,11px)] leading-[1.55] ${tone === 'light' ? 'text-white/60' : 'text-muted'}`}>{tagline}</p> : null}
    </div>
  )

  return (
    <div className={`relative overflow-hidden [container-type:inline-size] ${className}`} data-portfolio-hero={layout}>
      {dark ? (
        <div className="relative flex h-full items-end overflow-hidden bg-[#11110f]">
          <HeroPhoto url={photo(0)} name={name} className="absolute inset-0" imageClassName={layout === 'contact_sheet' || layout === 'noir' ? 'grayscale contrast-110' : ''} />
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/12 to-black/15" />
          {layout === 'contact_sheet' ? (
            <div className="absolute inset-x-[5%] top-[7%] grid h-[49%] grid-cols-2 gap-[2cqw]">
              {[0, 1, 2, 3].map((index) => <HeroPhoto key={index} url={photo(index)} name={name} className="border border-white/25" imageClassName="grayscale" />)}
            </div>
          ) : null}
          <div className="relative w-full p-[7cqw]">
            <p className="mb-[4cqw] text-[clamp(5px,2.5cqw,8px)] tracking-[0.2em] text-[var(--pf-accent)]">CIIYA · MOBILE EDITION</p>
            {mobileCopy('light')}
          </div>
        </div>
      ) : collage ? (
        <div className="flex h-full flex-col bg-[#f1ebe1] p-[4cqw]">
          <div className="grid min-h-0 flex-[1.35] grid-cols-2 grid-rows-2 gap-[2cqw]">
            <HeroPhoto url={photo(0)} name={name} className="row-span-2 rounded-[5cqw]" />
            <HeroPhoto url={photo(1)} name={name} className="rounded-[5cqw]" />
            <HeroPhoto url={photo(2)} name={name} className="rounded-[5cqw]" />
          </div>
          <div className="mt-[3cqw] flex min-h-0 flex-1 flex-col justify-end rounded-[5cqw] border border-[var(--pf-accent)]/35 bg-[#faf7f1] p-[6cqw]">
            <p className="mb-auto text-[clamp(5px,2.5cqw,8px)] tracking-[0.16em] text-[var(--pf-accent-deep)]">SELECTED STORIES · 01</p>
            {mobileCopy('dark')}
          </div>
        </div>
      ) : minimal ? (
        <div className="flex h-full flex-col items-center bg-[#f5f2ec] px-[7cqw] pb-[7cqw] pt-[10cqw] text-center">
          <p className="text-[clamp(5px,2.5cqw,8px)] tracking-[0.18em] text-[var(--pf-accent-deep)]">PORTFOLIO · CIIYA</p>
          <HeroPhoto url={photo(0)} name={name} className={`${roundImage ? 'rounded-t-[999px] rounded-b-[5cqw]' : 'rounded-[5cqw]'} mt-[7cqw] min-h-0 w-full flex-1`} />
          <div className="mt-[6cqw] w-full">{mobileCopy('dark', true)}</div>
        </div>
      ) : creator ? (
        <div className="flex h-full flex-col bg-[var(--pf-accent)] p-[4cqw]">
          <div className="flex min-h-0 flex-[1.45] gap-[2cqw]">
            <HeroPhoto url={photo(1)} name={name} className="mt-[12%] w-[25%] rounded-[4cqw] opacity-70" />
            <HeroPhoto url={photo(0)} name={name} className="w-[50%] rounded-[5cqw] shadow-card" />
            <HeroPhoto url={photo(2)} name={name} className="mt-[12%] w-[25%] rounded-[4cqw] opacity-70" />
          </div>
          <div className="flex min-h-0 flex-1 flex-col justify-end p-[5cqw]">{mobileCopy('dark')}</div>
        </div>
      ) : (
        <div className="flex h-full flex-col bg-[#f3eee6] p-[4cqw]">
          <HeroPhoto url={photo(0)} name={name} className={`${roundImage ? 'rounded-t-[999px] rounded-b-[5cqw]' : 'rounded-[5cqw]'} min-h-0 flex-[1.45]`} />
          <div className="mt-[3cqw] flex min-h-0 flex-1 flex-col justify-end rounded-[5cqw] bg-white/70 p-[6cqw]">
            <p className="mb-auto text-[clamp(5px,2.5cqw,8px)] tracking-[0.17em] text-[var(--pf-accent-deep)]">MOBILE PORTFOLIO · 01</p>
            {mobileCopy('dark')}
          </div>
        </div>
      )}
    </div>
  )
}

function HeroPhoto({
  url,
  name,
  priority = false,
  className = '',
  imageClassName = '',
}: {
  url?: string
  name: string
  priority?: boolean
  className?: string
  imageClassName?: string
}) {
  return (
    <div className={`relative overflow-hidden bg-line-strong ${className}`}>
      {url ? <Image src={url} alt={name} fill priority={priority} unoptimized sizes="100vw" className={`object-cover ${imageClassName}`} /> : <div className="absolute inset-0 bg-[linear-gradient(145deg,var(--pf-accent-soft),var(--ciiya-line-strong))]" />}
    </div>
  )
}
