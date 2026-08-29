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
    ? ['portrait', 'journal', 'noir'].includes(layout)
      ? 'text-[clamp(12px,2.2vw,20px)]'
      : 'text-[clamp(13px,4vw,26px)]'
    : layout === 'portrait'
      ? 'text-[clamp(1.45rem,7vw,4rem)] [overflow-wrap:anywhere]'
    : ['grid', 'masonry', 'luxe', 'portrait', 'journal'].includes(layout)
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
