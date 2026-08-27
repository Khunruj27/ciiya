import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getSafeRedirectPath } from '@/lib/safe-redirect'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/*
 * On Vercel the request URL carries the internal origin, so redirects built
 * from it can land the visitor on a deployment URL instead of the site they
 * started on. The forwarded headers carry the origin the browser actually
 * used.
 */
function getPublicOrigin(req: NextRequest) {
  const forwardedHost = req.headers.get('x-forwarded-host')

  if (!forwardedHost) return req.nextUrl.origin

  const forwardedProto =
    req.headers.get('x-forwarded-proto') || req.nextUrl.protocol.replace(':', '')

  return `${forwardedProto}://${forwardedHost}`
}

export async function GET(req: NextRequest) {
  const origin = getPublicOrigin(req)
  const code = req.nextUrl.searchParams.get('code')
  const next = getSafeRedirectPath(req.nextUrl.searchParams.get('next'))

  // Google sends the user back here with an error when they cancel the
  // consent screen, or when the provider rejects the request outright.
  const providerError =
    req.nextUrl.searchParams.get('error_description') ||
    req.nextUrl.searchParams.get('error')

  if (providerError) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(providerError)}`
    )
  }

  if (!code) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(
        'Didn’t receive a confirmation code from the provider. Please try again'
      )}`
    )
  }

  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    console.error('[auth/callback] code exchange failed:', error.message)

    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`
    )
  }

  return NextResponse.redirect(`${origin}${next}`)
}
