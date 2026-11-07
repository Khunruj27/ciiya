import Image from 'next/image'
import type { Portfolio } from '@/lib/portfolio-types'
import { composePortfolioGallery } from '@/lib/portfolio-gallery-composition'
import styles from './portfolio-gallery-layout.module.css'


export default function PortfolioGalleryLayout({ images, layout, photoLabel, onSelect, preview = false }: {
  images: string[]
  layout: Portfolio['gallery_layout']
  photoLabel: (index: number) => string
  onSelect?: (index: number) => void
  preview?: boolean
}) {
  const items = preview && !images.length ? Array<string>(12).fill('') : images
  const pages = composePortfolioGallery(layout, items.length)
  return <div className={styles.shell} data-gallery-layout={layout} data-preview={preview}>
    <div className={styles.layout}>
      {pages.map((page, pageIndex) => <div key={pageIndex} className={`${styles.page} ${styles[page.background] || ''}`} data-gallery-page={pageIndex}>
        {page.indices.map((index, slot) => {
          const url = items[index]
          const frame = page.frames[slot]
          const style = { left: `${frame.x}%`, top: `${frame.y}%`, width: `${frame.width}%`, height: `${frame.height}%` }
          const className = `${styles.tile} ${frame.border ? styles.framed : ''}`
          const contents = <><span className={styles.image}>{url ? <Image src={url} alt={preview ? '' : photoLabel(index)} fill unoptimized sizes={preview ? '140px' : '(max-width: 560px) 90vw, 560px'} draggable={false} /> : <span className={styles.placeholder} />}</span><span className={styles.number} aria-hidden>{String(index + 1).padStart(2, '0')}</span></>
          return preview ? <span key={index} className={className} style={style}>{contents}</span> : <button key={index} type="button" className={className} style={style} onClick={() => onSelect?.(index)} aria-label={photoLabel(index)}>{contents}</button>
        })}
      </div>)}
    </div>
  </div>
}
