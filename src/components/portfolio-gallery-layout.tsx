import Image from 'next/image'
import type { Portfolio } from '@/lib/portfolio-types'
import styles from './portfolio-gallery-layout.module.css'

export const UPDATED_GALLERY_LAYOUTS = ['carousel', 'grid', 'masonry', 'filmstrip', 'collage', 'collage_story', 'collage_panorama', 'collage_tiles', 'collage_overlap', 'collage_frames'] as const

export default function PortfolioGalleryLayout({ images, layout, photoLabel, onSelect, preview = false }: {
  images: string[]
  layout: Portfolio['gallery_layout']
  photoLabel: (index: number) => string
  onSelect?: (index: number) => void
  preview?: boolean
}) {
  const items = preview && !images.length ? Array<string>(6).fill('') : images
  return <div className={styles.shell} data-gallery-layout={layout} data-preview={preview}>
    <div className={`${styles.layout} ${styles[layout]}`}>
      {items.map((url, index) => {
        const contents = <><span className={styles.image}>{url ? <Image src={url} alt={preview ? '' : photoLabel(index)} fill unoptimized sizes="(max-width: 560px) 90vw, 560px" draggable={false} /> : <span className={styles.placeholder} />}</span><span className={styles.number} aria-hidden>{layout === 'filmstrip' ? 'FRAME ' : ''}{String(index + 1).padStart(2, '0')}</span></>
        return preview ? <span key={index} className={styles.tile}>{contents}</span> : <button key={`${url}-${index}`} type="button" className={styles.tile} onClick={() => onSelect?.(index)} aria-label={photoLabel(index)}>{contents}</button>
      })}
    </div>
  </div>
}
