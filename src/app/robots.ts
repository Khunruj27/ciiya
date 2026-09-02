import type { MetadataRoute } from 'next'
import { getSiteUrl } from '@/lib/site-url'

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl()

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Private, tokenized, or owner-only areas. /share carries tokenized
        // links to private galleries and must never be indexed. Public
        // published portfolios live under /portfolio/<slug> and stay crawlable.
        disallow: [
          '/api/',
          '/admin',
          '/me',
          '/albums',
          '/notifications',
          '/share',
          '/share-preview',
          '/share-preview-2',
          '/auth',
          '/forgot-password',
          '/reset-password',
        ],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  }
}
