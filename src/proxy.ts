import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value)
          })

          response = NextResponse.next({
            request,
          })

          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  await supabase.auth.getUser()

  return response
}

export const config = {
  // Session refresh is useful for authenticated server-rendered pages, but it
  // is unnecessary overhead on the landing page, public galleries, public
  // portfolios, auth entry pages and API routes (route handlers authenticate
  // themselves). Keep this list explicit so public requests stay fast and
  // large uploads are not buffered by Proxy.
  matcher: [
    '/admin/:path*',
    '/albums/:path*',
    '/me/:path*',
    '/notifications/:path*',
    '/portfolio',
    '/pricing/:path*',
    '/reset-password',
  ],
}
