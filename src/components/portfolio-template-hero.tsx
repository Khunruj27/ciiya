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
  const mobile = compact && previewDevice === 'mobile'
  const photo = (index: number) => images.length ? images[index % images.length] : undefined
  const pad = compact ? 'p-2.5' : 'px-4 pb-6 pt-20 sm:px-10 sm:pb-10 sm:pt-28 lg:px-16'
  const small = compact ? 'text-[clamp(5px,2.5cqw,8px)]' : 'text-[10px] sm:text-[12px]'
  const body = compact ? 'text-[clamp(6px,3.2cqw,10px)]' : 'text-[13px] sm:text-[16px]'
  const title = compact
    ? name.length > 18
      ? 'text-[clamp(7px,3.6cqw,11px)]'
      : name.length > 12
        ? 'text-[clamp(8px,4.2cqw,13px)]'
        : 'text-[clamp(9px,5.4cqw,17px)]'
    : name.length > 18
      ? 'text-[clamp(1.1rem,4vw,3.4rem)]'
      : name.length > 12
        ? 'text-[clamp(1.25rem,5vw,4rem)]'
        : 'text-[clamp(1.8rem,8vw,6.5rem)]'

  const copy = (tone: 'light' | 'dark' = 'dark', align: 'left' | 'center' | 'right' = 'left') => (
    <div className={`relative min-w-0 ${align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left'} ${tone === 'light' ? 'text-white' : 'text-ink'}`}>
      {location ? <p className={`${small} font-medium uppercase tracking-[0.18em] ${tone === 'light' ? 'text-white/60' : 'text-[var(--pf-accent-deep)]'}`}>{location}</p> : null}
      <h1 className={`pf-display mt-2 line-clamp-3 max-w-full font-semibold leading-[0.96] tracking-[-0.045em] [overflow-wrap:break-word] [word-break:normal] ${title}`}>{name}</h1>
      {tagline ? <p className={`mt-3 line-clamp-3 max-w-xl font-normal leading-relaxed ${body} ${align === 'center' ? 'mx-auto' : align === 'right' ? 'ml-auto' : ''} ${tone === 'light' ? 'text-white/65' : 'text-muted'}`}>{tagline}</p> : null}
      {actions ? <div className={compact ? 'hidden' : 'mt-7'}>{actions}</div> : null}
    </div>
  )

  const image = (index: number, className = '', imageClassName = '') => (
    <HeroPhoto key={`${layout}-${index}-${className}`} url={photo(index)} name={name} priority={!compact && index === 0} className={className} imageClassName={imageClassName} />
  )

  let content: ReactNode

  switch (layout) {
    case 'editorial':
      content = <div className={`${mobile ? 'grid-rows-[62%_38%]' : 'sm:grid-cols-[1.35fr_0.65fr] sm:grid-rows-1'} grid h-full grid-rows-[58%_42%] bg-[#f5f1e9]`}>
        {image(0, 'm-2 rounded-[10px] sm:m-5 sm:rounded-[22px]')}
        <div className={`${compact ? 'p-3' : 'px-6 pb-10 pt-5 sm:px-8 sm:pb-14 sm:pt-28'} flex flex-col justify-between border-t border-ink/10 sm:border-l sm:border-t-0`}><p className={`${small} tracking-[0.2em] text-[var(--pf-accent-deep)]`}>ISSUE Nº 01 · SELECTED WORK</p>{copy()}</div>
      </div>
      break
    case 'grid':
      content = <div className={`${pad} ${mobile ? 'grid-cols-2 grid-rows-[auto_1.5fr_0.8fr_0.8fr] gap-2' : 'grid-cols-2 grid-rows-[auto_1.5fr_0.8fr_0.8fr] gap-2 sm:grid-cols-4 sm:grid-rows-[auto_1fr_1fr] sm:gap-3'} grid h-full bg-[#f4f2ed]`}>
        <div className={`${mobile ? 'col-span-2' : 'col-span-2 sm:col-span-4'} flex items-end justify-between gap-3`}><div className="max-w-[76%]">{copy()}</div><span className={`${small} text-muted`}>ARCHIVE / 01—06</span></div>
        {image(0, `${mobile ? 'col-span-2' : 'col-span-2 sm:col-span-2 sm:row-span-2'} rounded-[8px] sm:rounded-[18px]`)}{[1,2,3,4].map((i) => image(i, 'rounded-[8px] sm:rounded-[18px]'))}
      </div>
      break
    case 'masonry':
      content = <div className={`${pad} h-full bg-[#ebe6dc]`}><div className={`${mobile ? 'grid-cols-[1.15fr_0.85fr] grid-rows-3 gap-2' : 'grid-cols-[1.15fr_0.85fr] grid-rows-3 gap-2 sm:grid-cols-[0.8fr_1.2fr_0.7fr] sm:grid-rows-2 sm:gap-4'} grid h-full`}>
        {image(0, 'row-span-2 rounded-t-[999px] rounded-b-[8px] sm:rounded-b-[20px]')}{image(1, 'rounded-[8px] sm:rounded-[20px]')}{image(2, 'row-span-2 rounded-[8px] sm:rounded-[20px]')}
        <div className={`${mobile ? 'col-span-2' : 'col-span-2 sm:col-span-1'} flex items-end rounded-[8px] bg-white/70 p-3 sm:rounded-[20px] sm:p-7`}>{copy()}</div>{image(3, mobile ? 'hidden' : 'hidden rounded-[20px] sm:block')}
      </div></div>
      break
    case 'stack':
      content = <div className="relative h-full overflow-hidden bg-[#171717]">
        {image(2, 'absolute left-[5%] top-[14%] h-[62%] w-[48%] -rotate-6 rounded-[8px] opacity-50 sm:rounded-[20px]')}{image(1, 'absolute right-[4%] top-[10%] h-[66%] w-[50%] rotate-5 rounded-[8px] opacity-70 sm:rounded-[20px]')}{image(0, 'absolute inset-x-[16%] top-[7%] h-[72%] -rotate-1 rounded-[8px] shadow-[0_30px_80px_rgba(0,0,0,0.45)] sm:inset-x-[27%] sm:rounded-[20px]')}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/90 to-transparent px-5 pb-8 pt-20 sm:px-14 sm:pb-14">{copy('light','center')}</div>
      </div>
      break
    case 'minimal':
      content = <div className={`${pad} flex h-full flex-col items-center justify-between bg-[#faf9f6] text-center`}><div className="w-full border-b border-ink/10 pb-3 text-left"><span className={`${small} tracking-[0.2em] text-muted`}>QUIET COLLECTION · 01</span></div>{image(0, 'my-4 h-[48%] w-[72%] rounded-[6px] shadow-[0_16px_45px_rgba(24,22,18,0.1)] sm:h-[58%] sm:w-[54%] sm:rounded-[16px]')}<div className="w-full max-w-3xl">{copy('dark','center')}</div></div>
      break
    case 'split':
      content = <div className={`${mobile ? 'grid-rows-[42%_58%]' : 'grid-rows-[42%_58%] sm:grid-cols-[0.8fr_1.2fr] sm:grid-rows-1'} grid h-full bg-[#1b1b19]`}><div className={`${compact ? 'p-4' : 'px-6 pb-10 pt-24 sm:px-10 sm:pb-14 sm:pt-28'} ${mobile ? 'order-2' : 'order-2 sm:order-1'} flex flex-col justify-between`}><p className={`${small} tracking-[0.2em] text-[var(--pf-accent)]`}>STUDIO / PROFILE</p>{copy('light')}</div>{image(0, `${mobile ? 'order-1' : 'order-1 sm:order-2'} m-2 rounded-[8px] sm:m-5 sm:rounded-[22px]`)}</div>
      break
    case 'classic':
      content = <div className={`${pad} relative flex h-full flex-col items-center bg-[#efe9df] text-center`}><div className="absolute inset-x-[12%] top-0 h-px bg-[#a98c5a]/45"/><p className={`${small} tracking-[0.22em] text-[#866d44]`}>HERITAGE PORTRAITS · MMXXVI</p>{image(0, 'my-4 min-h-0 w-[78%] flex-1 rounded-t-[999px] rounded-b-[8px] border-4 border-white shadow-card sm:w-[48%] sm:rounded-b-[22px] sm:border-8')}<div className="max-w-3xl">{copy('dark','center')}</div></div>
      break
    case 'bold':
      content = <div className={`${pad} ${mobile ? 'grid-rows-[auto_1fr] gap-3' : 'grid-rows-[auto_1fr] gap-3 sm:grid-cols-[0.9fr_1.1fr] sm:grid-rows-1 sm:gap-8'} grid h-full overflow-hidden bg-[var(--pf-accent)]`}><div className="flex min-w-0 flex-col justify-between"><p className={`${small} font-semibold tracking-[0.2em]`}>CREATOR IMPACT · 01</p>{copy()}<span className={`${small} hidden sm:block`}>BOLD STORIES / CIIYA</span></div>{image(0, 'min-h-0 rotate-[2deg] rounded-[8px] border-4 border-ink shadow-[10px_12px_0_#171717] sm:rounded-[22px] sm:border-8')}</div>
      break
    case 'luxe':
      content = <div className={`${pad} h-full overflow-hidden bg-[#f3ede3]`}><div className={`${mobile ? 'grid-rows-[1.25fr_0.75fr] gap-3' : 'grid-rows-[1.25fr_0.75fr] gap-3 sm:grid-cols-[1.15fr_0.85fr] sm:grid-rows-1 sm:gap-10'} grid h-full`}><div className="relative min-h-0"><div className="absolute inset-[5%_10%_0_0] rounded-t-[999px] border border-[#b79a6b]/55"/>{image(0, 'absolute inset-[0_0_6%_8%] rounded-t-[999px] rounded-b-[8px] sm:rounded-b-[24px]')}{image(1, 'absolute bottom-0 right-0 h-[34%] w-[38%] rounded-[8px] border-4 border-[#f3ede3] sm:rounded-[18px] sm:border-8')}</div><div className="flex min-w-0 flex-col justify-center overflow-hidden border-y border-[#b79a6b]/45 py-3"><p className={`${small} mb-auto tracking-[0.2em] text-[#876b40]`}>MAISON / SIGNATURE</p>{copy()}<p className={`${small} mt-auto text-[#876b40]`}>Love · Light · Legacy</p></div></div></div>
      break
    case 'portrait':
      content = <div className={`${pad} ${mobile ? 'grid-rows-[1.28fr_0.72fr] gap-2' : 'grid-rows-[1.28fr_0.72fr] gap-3 sm:grid-cols-[0.7fr_1.3fr_0.55fr] sm:grid-rows-1 sm:gap-8'} grid h-full bg-[#e8e4dc]`}><div className={`${mobile ? 'order-2' : 'order-2 sm:order-1'} flex min-w-0 flex-col justify-end overflow-hidden border-t border-ink/15 pt-2 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0`}><span className={`${small} mb-auto tracking-[0.12em] text-muted`}>PORTRAIT ATELIER · 01</span>{copy()}</div>{image(0, `${mobile ? 'order-1' : 'order-1 sm:order-2'} min-h-0 min-w-0 rounded-t-[999px] rounded-b-[8px] sm:rounded-b-[24px]`)}<div className={mobile ? 'hidden' : 'order-3 hidden flex-col justify-end sm:flex'}>{image(1, 'h-[42%] rounded-[18px]')}<p className={`${small} mt-4 text-muted`}>PERSONAL STUDY<br/>FRAME Nº 02</p></div></div>
      break
    case 'journal':
      content = <div className={`${pad} ${mobile ? 'grid-rows-[0.72fr_1.28fr] gap-3' : 'grid-rows-[0.72fr_1.28fr] gap-3 sm:grid-cols-[0.72fr_1.28fr] sm:grid-rows-1 sm:gap-8'} relative grid h-full overflow-hidden bg-[#f4efe6]`}><div className="absolute inset-0 opacity-20 [background-image:linear-gradient(#b8ad9c_1px,transparent_1px),linear-gradient(90deg,#b8ad9c_1px,transparent_1px)] [background-size:28px_28px]"/><div className="relative flex min-w-0 flex-col justify-between overflow-hidden rounded-[8px] border border-ink/15 bg-[#fffdf8]/90 p-3 sm:rounded-[20px] sm:p-7"><span className={`${small} tracking-[0.18em] text-[var(--pf-accent-deep)]`}>FIELD NOTES / ENTRY 01</span>{copy()}<span className={`${small} text-muted`}>DATE · PLACE · PEOPLE</span></div><div className="relative grid min-h-0 grid-cols-[1.25fr_0.75fr] grid-rows-2 gap-2 sm:gap-4">{image(0, 'row-span-2 rounded-[8px] sm:rounded-[20px]')}{image(1, 'rounded-[8px] sm:rounded-[20px]')}{image(2, 'rounded-[8px] sm:rounded-[20px]')}</div></div>
      break
    case 'noir':
      content = <div className={`${pad} ${mobile ? 'grid-rows-[1.25fr_0.75fr] gap-2' : 'grid-rows-[1.25fr_0.75fr] gap-2 sm:grid-cols-[1.3fr_0.7fr] sm:grid-rows-1 sm:gap-5'} grid h-full bg-[#10100f] text-white`}><div className="relative min-h-0 border border-white/15 p-1.5 sm:p-3">{image(0, 'h-full', 'grayscale contrast-125')}<span className={`${small} absolute bottom-3 left-3 bg-black/70 px-2 py-1 text-white/60`}>FRAME 001</span></div><div className="flex min-w-0 flex-col justify-between overflow-hidden border border-white/15 p-3 sm:p-8"><div className="flex items-center justify-between"><span className={`${small} text-white/45`}>NOIR Nº 01</span><span className="h-px w-8 bg-[var(--pf-accent)]"/></div>{copy('light')}<span className={`${small} text-white/35`}>CIIYA / SELECTED WORK</span></div></div>
      break
    case 'monogram':
      content = <div className={`${pad} ${mobile ? 'grid-rows-[1.2fr_0.8fr] gap-3' : 'grid-rows-[1.2fr_0.8fr] gap-3 sm:grid-cols-[1.1fr_0.9fr] sm:grid-rows-1 sm:gap-10'} grid h-full bg-[#f3ede4]`}><div className="relative min-h-0">{image(0, 'absolute inset-[0_8%_5%_0] rounded-t-[999px] rounded-b-[8px] sm:rounded-b-[24px]')}<div className={`${compact ? 'h-10 w-10 text-sm' : 'h-16 w-16 text-xl'} absolute bottom-0 right-0 grid place-items-center rounded-full border border-[#aa8b5a] bg-[#faf7f1] pf-display text-[#795f38] sm:h-24 sm:w-24 sm:text-3xl`}>{name.slice(0,1).toUpperCase()}</div></div><div className="flex min-w-0 flex-col justify-between overflow-hidden border-y border-[#aa8b5a]/45 py-3 sm:py-8"><span className={`${small} tracking-[0.2em] text-[#806640]`}>MONOGRAM HOUSE</span>{copy()}<span className={`${small} text-[#806640]`}>EST. MMXXVI</span></div></div>
      break
    case 'horizon':
      content = <div className="flex h-full flex-col bg-[#e9e6de]"><div className="relative h-[64%] overflow-hidden sm:h-[70%]">{image(0, 'absolute inset-0')}<div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/10"/><p className={`${small} absolute left-5 top-5 tracking-[0.2em] text-white/75 sm:left-12 sm:top-9`}>HORIZON FILM / 01</p></div><div className={`${compact ? 'px-3 py-3' : 'px-6 py-6 sm:px-12 sm:py-9'} grid flex-1 grid-cols-[1fr_auto] items-end gap-5`}>{copy()}<span className={`${small} text-muted`}>01 / 10</span></div></div>
      break
    case 'museum':
      content = <div className={`${pad} ${mobile ? 'grid-rows-[1fr_auto] gap-3' : 'grid-rows-[1fr_auto] gap-3 sm:grid-cols-[0.45fr_1.55fr_0.7fr] sm:grid-rows-1 sm:gap-8'} grid h-full bg-[#fbfaf7]`}><div className={mobile ? 'hidden' : 'hidden flex-col justify-between border-r border-ink/10 pr-6 sm:flex'}><span className={`${small} text-muted`}>ROOM 01</span><span className="pf-display text-5xl text-[var(--pf-accent-deep)]">01</span></div><div className="flex min-h-0 items-center justify-center bg-[#efede7] p-4 sm:p-8">{image(0, 'h-[88%] w-[84%] border-[6px] border-white shadow-[0_18px_50px_rgba(20,18,14,0.15)] sm:border-[12px]')}</div><div className="flex min-w-0 flex-col justify-end overflow-hidden border-t border-ink/10 pt-3 sm:border-l sm:border-t-0 sm:pl-8 sm:pt-0">{copy()}</div></div>
      break
    case 'polaroid':
      content = <div className={`${pad} relative h-full overflow-hidden bg-[#d7c7b2]`}><div className="absolute inset-0 opacity-20 [background-image:radial-gradient(#675746_0.8px,transparent_0.8px)] [background-size:12px_12px]"/>{image(1, 'absolute left-[7%] top-[12%] h-[53%] w-[54%] -rotate-6 border-[7px] border-white border-b-[22px] shadow-card sm:border-[12px] sm:border-b-[38px]')}{image(0, 'absolute right-[7%] top-[18%] h-[55%] w-[56%] rotate-5 border-[7px] border-white border-b-[22px] shadow-card sm:border-[12px] sm:border-b-[38px]')}<div className="absolute inset-x-[8%] bottom-[5%] rounded-[10px] bg-[#f8f0e5]/90 p-3 backdrop-blur sm:inset-x-[20%] sm:rounded-[22px] sm:p-7">{copy('dark','center')}</div></div>
      break
    case 'duotone':
      content = <div className={`${pad} ${mobile ? 'grid-rows-[1.2fr_0.8fr] gap-2' : 'grid-rows-[1.2fr_0.8fr] gap-2 sm:grid-cols-[1.15fr_0.85fr] sm:grid-rows-1 sm:gap-4'} grid h-full bg-[#111]`}><div className="grid min-h-0 grid-cols-2 gap-2 sm:gap-4">{image(0, '', 'grayscale contrast-125')}{image(1, '', 'grayscale contrast-150')}</div><div className="flex min-w-0 flex-col justify-between overflow-hidden bg-[var(--pf-accent)] p-3 text-ink sm:p-8"><span className={`${small} tracking-[0.2em]`}>DUOTONE / 01</span>{copy()}<span className="h-px w-full bg-ink/35"/></div></div>
      break
    case 'coverflow':
      content = <div className={`${pad} relative flex h-full items-center justify-center gap-2 overflow-hidden bg-[#e7e4dd] sm:gap-5`}>{image(1, 'h-[54%] w-[22%] -rotate-6 rounded-[6px] opacity-55 sm:h-[65%] sm:w-[27%] sm:rounded-[16px]')}<div className="relative z-10 h-[82%] w-[58%] shadow-[0_22px_60px_rgba(20,18,14,0.22)] sm:w-[42%]">{image(0, 'absolute inset-0 rounded-[8px] sm:rounded-[18px]')}<div className="absolute inset-0 rounded-[8px] bg-gradient-to-t from-black/85 via-transparent to-black/10 sm:rounded-[18px]"/><div className="absolute inset-x-0 bottom-0 p-3 sm:p-8">{copy('light')}</div></div>{image(2, 'h-[54%] w-[22%] rotate-6 rounded-[6px] opacity-55 sm:h-[65%] sm:w-[27%] sm:rounded-[16px]')}</div>
      break
    case 'mosaic_luxe':
      content = <div className={`${pad} ${mobile ? 'grid-cols-2 grid-rows-[1.15fr_0.85fr] gap-2' : 'grid-cols-2 grid-rows-[1.15fr_0.85fr] gap-2 sm:grid-cols-[1.2fr_0.72fr_0.88fr] sm:grid-rows-2 sm:gap-4'} grid h-full bg-[#eee5d8]`}>{image(0, `${mobile ? 'col-span-2' : 'col-span-2 sm:col-span-1 sm:row-span-2'} rounded-[9px] sm:rounded-[22px]`)}{image(1, 'rounded-[9px] sm:rounded-[22px]')}<div className={`${mobile ? '' : 'sm:row-span-2'} flex min-w-0 flex-col justify-between overflow-hidden rounded-[9px] border border-[#b59a6c]/50 bg-[#f8f2e8] p-3 sm:rounded-[22px] sm:p-7`}><span className={`${small} text-[#866c43]`}>LUXE MOSAIC</span>{copy()}</div>{image(2, mobile ? 'hidden' : 'hidden rounded-[22px] sm:block')}</div>
      break
    case 'contact_sheet':
      content = <div className={`${pad} flex h-full flex-col gap-3 bg-[#151513] text-white sm:gap-5`}><div className="flex items-end justify-between gap-4 overflow-hidden border-b border-white/20 pb-3"><div className="max-w-[72%]">{copy('light')}</div><span className={`${small} shrink-0 text-right text-white/45`}>ROLL 01<br/>001—006</span></div><div className={`${mobile ? 'grid-cols-2 grid-rows-3 gap-2' : 'grid-cols-2 grid-rows-3 gap-2 sm:grid-cols-3 sm:grid-rows-2 sm:gap-3'} grid min-h-0 flex-1`}>{[0,1,2,3,4,5].map((i) => <div key={i} className="relative min-h-0 border border-white/15 p-1 sm:p-2">{image(i, 'h-full', 'grayscale')}<span className="absolute bottom-1 right-1 bg-black/70 px-1 text-[6px] text-white/60">0{i+1}</span></div>)}</div></div>
      break
    case 'letterbox':
      content = <div className="flex h-full flex-col justify-center overflow-hidden bg-black text-white"><div className="relative h-[54%] w-full overflow-hidden border-y border-white/15 sm:h-[62%]">{image(0, 'absolute inset-0')}<div className="absolute inset-0 bg-gradient-to-r from-black/55 via-transparent to-black/45"/><span className={`${small} absolute left-4 top-3 tracking-[0.2em] text-white/60 sm:left-10 sm:top-6`}>CIIYA FILM · TAKE 01</span></div><div className={`${compact ? 'px-4 py-3' : 'px-6 py-7 sm:px-12 sm:py-10'} grid grid-cols-[1fr_auto] items-end gap-5`}>{copy('light')}<span className={`${small} hidden text-right text-white/35 sm:block`}>2.39 : 1<br/>SELECTED FILM</span></div></div>
      break
    case 'sanctuary':
      content = <div className={`${pad} ${mobile ? 'grid-rows-[1.25fr_0.75fr] gap-3' : 'grid-rows-[1.25fr_0.75fr] gap-3 sm:grid-cols-[1fr_1fr] sm:grid-rows-1 sm:gap-10'} relative grid h-full overflow-hidden bg-[#f3efe8]`}><div className="absolute left-[8%] top-[10%] h-[65%] w-[65%] rounded-full bg-white/65 blur-3xl"/><div className="relative flex min-h-0 items-center justify-center">{image(0, 'h-[92%] w-[72%] rounded-[50%] border-[6px] border-white shadow-[0_18px_50px_rgba(91,75,55,0.15)] sm:border-[10px]')}{image(1, 'absolute bottom-0 right-[4%] h-[34%] w-[34%] rounded-full border-4 border-[#f3efe8] sm:border-8')}</div><div className="relative flex min-w-0 flex-col items-center justify-center overflow-hidden text-center"><span className={`${small} mb-3 tracking-[0.2em] text-[var(--pf-accent-deep)]`}>SOFT SANCTUARY</span>{copy('dark','center')}<span className="mt-4 h-px w-14 bg-[var(--pf-accent)] sm:mt-8 sm:w-20"/></div></div>
      break
    default:
      content = <div className="relative flex h-full items-end bg-ink">{image(0, 'absolute inset-0')}<div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-black/15"/><div className={`relative w-full ${pad}`}>{copy('light')}</div></div>
  }

  return <div className={`overflow-hidden [container-type:inline-size] ${className}`} data-portfolio-hero={layout} data-preview-device={previewDevice}>{content}</div>
}

function HeroPhoto({ url, name, priority = false, className = '', imageClassName = '' }: {
  url?: string
  name: string
  priority?: boolean
  className?: string
  imageClassName?: string
}) {
  return <div className={`relative overflow-hidden bg-line-strong ${className}`}>
    {url ? <Image src={url} alt={name} fill priority={priority} unoptimized sizes="100vw" className={`object-cover ${imageClassName}`} /> : <div className="absolute inset-0 bg-[linear-gradient(145deg,var(--pf-accent-soft),var(--ciiya-line-strong))]" />}
  </div>
}
