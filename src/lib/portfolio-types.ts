export type Portfolio = {
  user_id: string
  slug: string
  display_name: string | null
  tagline: string | null
  bio: string | null
  location: string | null
  hero_photo_url: string | null
  gallery_urls: string[]
  gallery_layout:
    | 'carousel'
    | 'grid'
    | 'masonry'
    | 'filmstrip'
    | 'collage'
    | 'collage_story'
    | 'collage_panorama'
    | 'collage_tiles'
    | 'collage_overlap'
    | 'collage_frames'
  contact_line: string | null
  contact_phone: string | null
  contact_email: string | null
  contact_instagram: string | null
  contact_facebook: string | null
  contact_tiktok: string | null
  contact_website: string | null
  show_contact_line: boolean
  show_contact_phone: boolean
  show_contact_email: boolean
  show_contact_instagram: boolean
  show_contact_facebook: boolean
  show_contact_tiktok: boolean
  show_contact_website: boolean
  accent: 'gold' | 'ink' | 'rose'
  layout:
    | 'editorial'
    | 'grid'
    | 'masonry'
    | 'stack'
    | 'minimal'
    | 'split'
    | 'classic'
    | 'bold'
    | 'luxe'
    | 'portrait'
    | 'journal'
    | 'noir'
    | 'monogram'
    | 'horizon'
    | 'museum'
    | 'polaroid'
    | 'duotone'
    | 'coverflow'
    | 'mosaic_luxe'
    | 'contact_sheet'
    | 'letterbox'
    | 'sanctuary'
  is_published: boolean
}

export type PortfolioAlbum = {
  id: string
  title: string
  description: string | null
  cover_url: string | null
  share_token: string
  photo_count: number
  view_count: number
  created_at: string
}

export type PortfolioView = {
  portfolio: Portfolio
  albums: PortfolioAlbum[]
  totalPhotos: number
  totalViews: number
  showcase: string[]
}
