/**
 * The canonical, absolute origin of the site — used for metadataBase, the
 * sitemap, robots, and Open Graph URLs.
 *
 * NEXT_PUBLIC_SITE_URL is authoritative when it points at a real host, but it
 * is `http://localhost:3000` in local dev, which must never leak into
 * production metadata. So localhost (or an empty value) falls back to Vercel's
 * own production URL, then to the current deploy URL, then to the known
 * vercel.app alias. Set NEXT_PUBLIC_SITE_URL to the custom domain once it is
 * live and it takes over everywhere.
 */
export function getSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (explicit && !/localhost|127\.0\.0\.1/.test(explicit)) {
    return explicit.replace(/\/$/, '')
  }

  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL
  if (prod) return `https://${prod}`

  const current = process.env.VERCEL_URL
  if (current) return `https://${current}`

  return 'https://ciiya.vercel.app'
}
