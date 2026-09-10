import Image from 'next/image'
import type { ReactNode } from 'react'
import styles from './portfolio-first-five.module.css'

export const REDESIGNED_LAYOUTS = ['editorial', 'grid', 'masonry', 'stack', 'minimal', 'split', 'classic', 'bold', 'luxe', 'portrait', 'journal', 'noir', 'monogram', 'horizon', 'museum', 'polaroid', 'duotone', 'coverflow', 'mosaic_luxe', 'contact_sheet', 'letterbox', 'sanctuary'] as const

export default function PortfolioFirstFive({ layout, name, tagline, location, images, compact, actions }: {
  layout: string
  name: string
  tagline?: string | null
  location?: string | null
  images: string[]
  compact: boolean
  actions?: ReactNode
}) {
  const photo = (index: number, className = '') => {
    const url = images.length ? images[index % images.length] : null
    return <div className={`${styles.photo} ${className}`}>
      {url ? <Image src={url} alt={`${name} · ${index + 1}`} fill unoptimized priority={!compact && index === 0} sizes="(max-width: 560px) 100vw, 560px" /> : <div className={styles.placeholder} />}
    </div>
  }
  const copy = <div className={styles.copy}>
    {location ? <p className={styles.location}>{location}</p> : null}
    <h1 className={styles.title}>{name}</h1>
    {tagline ? <p className={styles.tagline}>{tagline}</p> : null}
  </div>
  const label = (text: string, number: string) => <div className={styles.label}><span>{text}</span><span>{number}</span></div>
  return <div className={`${styles.canvas} ${styles[layout]}`} data-compact={compact}>
    {layout === 'editorial' ? <>
      {label('THE EDITORIAL', '01')}
      {copy}
      <div className={styles.editorialImages}>{photo(0)}{images.length > 1 ? photo(1, styles.inset) : null}</div>
      <div className={styles.caption}><span>ภาพที่บอกเล่าเรื่องราว</span><span>SELECTED WORK</span></div>
    </> : null}
    {layout === 'grid' ? <>
      {label('CLEAN ARCHIVE', '02')}
      {copy}
      <div className={styles.archiveImages}>{[0, 1, 2, 3].map(index => <div className={styles.archiveFrame} key={index}>{photo(index)}<span>0{index + 1}</span></div>)}</div>
    </> : null}
    {layout === 'masonry' ? <>
      {label('LIVING FRAMES', '03')}
      <div className={styles.livingImages}>{photo(0)}{photo(1)}{photo(2)}</div>
      {copy}
      <div className={styles.caption}><span>ทุกภาพมีเรื่องราว</span><span>MEMORIES, IN FRAME</span></div>
    </> : null}
    {layout === 'stack' ? <>
      {photo(0, styles.cinemaImage)}
      <div className={styles.cinemaShade} />
      <div className={styles.cinemaContent}>{label('CINEMA ONE', '04')}<div className={styles.cinemaCopy}><span className={styles.kicker}>A STORY WORTH KEEPING</span>{copy}<div className={styles.filmstrip}>{[1, 2, 3].map(index => <div key={index}>{photo(index)}</div>)}</div></div></div>
    </> : null}
    {layout === 'minimal' ? <>
      {label('WHITESPACE', '05')}
      <div className={styles.quietImage}>{photo(0)}</div>
      {copy}
      <span className={styles.quietRule} />
    </> : null}
    {layout === 'split' ? <>
      {label('STUDIO PROFILE', '06')}
      <div className={styles.studioCopy}>{copy}</div>
      <div className={styles.studioImages}>{photo(0)}<div className={styles.studioSide}>{photo(1)}<span>ภาพและเรื่องราว<br />ในมุมมองของเรา</span></div></div>
      <div className={styles.caption}><span>ผลงานคัดสรร</span><span>STUDIO / SELECTED</span></div>
    </> : null}
    {layout === 'classic' ? <>
      {label('HERITAGE', '07')}
      <div className={styles.heritageFrame}>{photo(0)}<span className={styles.seal} aria-hidden>{Array.from(name.trim())[0]?.toUpperCase() || 'H'}</span></div>
      {copy}
      <div className={styles.heritageRule} aria-hidden><span />◇<span /></div>
      <p className={styles.heritageCaption}>ช่วงเวลาที่งดงามเหนือกาลเวลา</p>
    </> : null}
    {layout === 'bold' ? <>
      {label('CREATOR IMPACT', '08')}
      {copy}
      <div className={styles.creatorImages}>{photo(0)}{images.length > 1 ? photo(1, styles.creatorInset) : null}<span className={styles.creatorMark} aria-hidden>↗</span></div>
      <div className={styles.creatorFooter}><span>มุมมองที่แตกต่าง</span><span>MAKE IT YOURS.</span></div>
    </> : null}
    {layout === 'luxe' ? <>
      {label('MAISON ROMANCE', '09')}
      {copy}
      <div className={styles.romanceImages}>{photo(0)}{images.length > 1 ? photo(1, styles.romanceDetail) : null}</div>
      <div className={styles.romanceCaption}><span />ช่วงเวลาของเรา<span /></div>
    </> : null}
    {layout === 'portrait' ? <>
      {label('PORTRAIT ATELIER', '10')}
      <div className={styles.portraitFrame}>{photo(0)}<span className={styles.portraitIndex}>PORTRAIT / 01</span></div>
      <div className={styles.portraitCopy}>{copy}</div>
      {images.length > 1 ? <div className={styles.portraitFoot}>{photo(1)}<span>แสง บุคลิก<br />และตัวตนที่เป็นคุณ</span></div> : null}
    </> : null}
    {layout === 'journal' ? <>
      {label('FIELD NOTES', '11')}
      {copy}
      <div className={styles.journalPrint}>{photo(0)}<div className={styles.caption}><span>01 / เรื่องราวระหว่างทาง</span><span>FIELD STUDY</span></div></div>
      {images.length > 1 ? <div className={styles.journalFoot}><span>รายละเอียดเล็ก ๆ<br />ที่อยากเก็บไว้</span>{photo(1)}</div> : null}
    </> : null}
    {layout === 'noir' ? <>
      {label('MIDNIGHT EDITION', '12')}
      <div className={styles.noirImages}>{photo(0)}{images.length > 1 ? photo(1) : null}</div>
      <div className={styles.noirCopy}><span className={styles.noirKicker}>LIGHT / SHADOW / CHARACTER</span>{copy}</div>
      <div className={styles.caption}><span>มุมมองที่ชัดเจน</span><span>AFTER DARK.</span></div>
    </> : null}
    {layout === 'monogram' ? <>
      {label('MONOGRAM HOUSE', '13')}
      <div className={styles.houseSeal} aria-hidden>{Array.from(name.trim())[0]?.toUpperCase() || 'M'}</div>
      {copy}
      <div className={styles.houseImages}>{photo(0)}{images.length > 1 ? photo(1) : null}</div>
      <p className={styles.houseCaption}>ความทรงจำที่เป็นเอกลักษณ์ของคุณ</p>
    </> : null}
    {layout === 'horizon' ? <>
      {label('HORIZON FILM', '14')}
      <div className={styles.horizonImage}>{photo(0)}<span>แสงสุดท้าย / เรื่องราวใหม่</span></div>
      {copy}
      {images.length > 1 ? <div className={styles.horizonDetail}>{photo(1)}<span>BEYOND<br />THE FRAME.</span></div> : null}
    </> : null}
    {layout === 'museum' ? <>
      {label('WHITE MUSEUM', '15')}
      <div className={styles.museumFrame}>{photo(0)}</div>
      <div className={styles.museumCopy}><span className={styles.exhibit}>01</span>{copy}</div>
      <div className={styles.caption}><span>ภาพคัดสรร</span><span>THE PRIVATE COLLECTION</span></div>
    </> : null}
    {layout === 'polaroid' ? <>
      {label('MEMORY DESK', '16')}
      <div className={styles.memoryPrints}><div>{photo(0)}{images.length <= 1 ? <span>ความทรงจำที่อยากเก็บไว้</span> : <span aria-hidden>01</span>}</div>{images.length > 1 ? <div>{photo(1)}<span>ช่วงเวลาเล็ก ๆ ของเรา</span></div> : null}</div>
      <div className={styles.memoryNote}>{copy}</div>
    </> : null}
    {layout === 'duotone' ? <>
      {label('DUOTONE STUDIO', '17')}
      {copy}
      <div className={styles.duotoneImages}>{photo(0)}{images.length > 1 ? photo(1) : null}</div>
      <div className={styles.duotoneFooter}><span>สองมุมมอง เรื่องราวเดียว</span><span>01 / 02</span></div>
    </> : null}
    {layout === 'coverflow' ? <>
      {label('COVER FLOW', '18')}
      <div className={styles.coverStage}>{images.length > 1 ? photo(1, styles.coverLeft) : null}{images.length > 2 ? photo(2, styles.coverRight) : null}{photo(0, styles.coverMain)}</div>
      {copy}
      <div className={styles.caption}><span>คอลเลกชันของคุณ</span><span>THE COVER STORY</span></div>
    </> : null}
    {layout === 'mosaic_luxe' ? <>
      {label('LUXE MOSAIC', '19')}
      {copy}
      <div className={styles.luxeTiles}>{photo(0)}{images.length > 1 ? photo(1) : null}{images.length > 2 ? photo(2) : null}</div>
      <div className={styles.romanceCaption}><span />ภาพเล็ก ๆ ในวันสำคัญ<span /></div>
    </> : null}
    {layout === 'contact_sheet' ? <>
      {label('CONTACT SHEET', '20')}
      {copy}
      <div className={styles.contactFrames}>{Array.from({length: Math.min(6, Math.max(1, images.length))}, (_, index) => <div key={index}>{photo(index)}<span>FRAME {String(index + 1).padStart(2, '0')}</span></div>)}</div>
      <div className={styles.caption}><span>ผลงานที่คัดสรร</span><span>ROLL / 001</span></div>
    </> : null}
    {layout === 'letterbox' ? <>
      {label('LETTERBOX CINEMA', '21')}
      <div className={styles.letterboxFrame}><span>เรื่องราวเริ่มต้นที่นี่</span>{photo(0)}<span>PICTURE / 01</span></div>
      {copy}
      {images.length > 1 ? <div className={styles.letterboxStill}>{photo(1)}<span>อีกหนึ่งเฟรม<br />ที่มีความหมาย</span></div> : null}
    </> : null}
    {layout === 'sanctuary' ? <>
      {label('SOFT SANCTUARY', '22')}
      <div className={styles.sanctuaryImages}>{photo(0)}{images.length > 1 ? photo(1) : null}</div>
      {copy}
      <div className={styles.romanceCaption}><span />พื้นที่ของความทรงจำ<span /></div>
    </> : null}
    {!compact && actions ? <div className={styles.actions}>{actions}</div> : null}
  </div>
}
