import type { Portfolio } from '@/lib/portfolio-types'

export type PortfolioTemplateMeta = {
  key: Portfolio['layout']
  label: string
  hint: string
  mood: string
  category: string
  badge?: string
}

export const PORTFOLIO_TEMPLATES: PortfolioTemplateMeta[] = [
  {
    key: 'editorial',
    label: 'Signature Editorial',
    hint: 'A hero image and type laid out like a magazine cover — great for storytelling',
    mood: 'Elegant · Storytelling',
    category: 'Popular',
  },
  {
    key: 'grid',
    label: 'Modern Gallery',
    hint: 'Show many photos upfront with a crisp structure for quick browsing',
    mood: 'Modern · Structured',
    category: 'Versatile',
  },
  {
    key: 'masonry',
    label: 'Visual Story',
    hint: 'Alternating portrait and landscape shots for a natural, lively rhythm',
    mood: 'Warm · Friendly',
    category: 'Lifestyle',
  },
  {
    key: 'stack',
    label: 'Cinematic',
    hint: 'Full-screen photos and a large title make an instant impression',
    mood: 'Bold · Immersive',
    category: 'Events',
  },
  {
    key: 'minimal',
    label: 'Quiet Minimal',
    hint: 'Lots of whitespace, focused on the name and details — ideal for architecture and art',
    mood: 'Calm · Premium',
    category: 'Minimal',
  },
  {
    key: 'split',
    label: 'Studio Split',
    hint: 'A clear split between image and text — ideal for a professional studio look',
    mood: 'Professional · Clear',
    category: 'Studio',
  },
  {
    key: 'classic',
    label: 'Timeless Classic',
    hint: 'Symmetrical, refined, and elegant — great for ceremonies and family portraits',
    mood: 'Classic · Trusted',
    category: 'Ceremonies',
  },
  {
    key: 'bold',
    label: 'Bold Creator',
    hint: 'Big type, vivid color, and punchy composition for fashion and creators',
    mood: 'Confident · Contemporary',
    category: 'Fashion',
  },
  {
    key: 'luxe',
    label: 'Luxe Wedding',
    hint: 'Delicately layered frames in soft, warm tones — perfect for weddings and pre-weddings',
    mood: 'Romantic · Refined',
    category: 'Weddings',
    badge: 'new',
  },
  {
    key: 'portrait',
    label: 'Portrait Focus',
    hint: 'Puts vertical portraits front and center with studio-grade portfolio detail',
    mood: 'Graceful · Characterful',
    category: 'Portraits',
    badge: 'new',
  },
  {
    key: 'journal',
    label: 'Photo Journal',
    hint: 'Photos arranged like a journal, with numbers and an easygoing narrative rhythm',
    mood: 'Genuine · Narrative',
    category: 'Documentary',
    badge: 'new',
  },
  {
    key: 'noir',
    label: 'Noir Atelier',
    hint: 'Dark backdrops, high-contrast images, and premium fashion-studio lines',
    mood: 'Dark · Exclusive',
    category: 'Fashion',
    badge: 'new',
  },
]

export function getPortfolioTemplate(layout: Portfolio['layout']) {
  return PORTFOLIO_TEMPLATES.find((template) => template.key === layout)
}

export function templateUsesDarkHero(layout: Portfolio['layout']) {
  return ['stack', 'split', 'classic', 'noir'].includes(layout)
}
