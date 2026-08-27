import PortfolioTemplateHero from '@/components/portfolio-template-hero'
import type { Portfolio } from '@/lib/portfolio-types'

const layouts: Portfolio['layout'][] = ['luxe', 'portrait', 'journal', 'noir']
const images = [
  'https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1511285560929-80b456fea0bc?auto=format&fit=crop&w=1200&q=85',
  'https://images.unsplash.com/photo-1519225421980-715cb0215aed?auto=format&fit=crop&w=1200&q=85',
]

export default function TemplateQaPage() {
  return (
    <main className="space-y-8 bg-ground p-4 sm:p-8" data-accent="gold">
      {layouts.map((layout) => (
        <section key={layout} className="h-[760px] overflow-hidden rounded-hero border border-line shadow-lift sm:h-[720px]">
          <PortfolioTemplateHero
            layout={layout}
            name="Thanawat Photo"
            tagline="Capturing real feeling, so every photo takes you back to the day that mattered"
            location="Chiang Mai · Thailand"
            images={images}
            className="h-full"
          />
        </section>
      ))}
    </main>
  )
}
