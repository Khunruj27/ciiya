import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  experimental: {
    // proxy.ts refreshes the Supabase session for every request, so Next.js
    // buffers uploads before forwarding them to route handlers. Guest Moments
    // accepts up to 32MB of images plus multipart metadata; the default 10MB
    // buffer truncated those requests and made request.formData() fail.
    // Caps every request body the proxy buffers. Any form-data route handler
    // (e.g. /api/photos/upload, used for cover images) must keep its own size
    // check at or below this value, or it advertises a limit the proxy will
    // not honour.
    proxyClientMaxBodySize: '40mb',
  },

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
      },
      /*
       * Google account avatars. Signing in with Google puts a
       * lh3.googleusercontent.com URL in user_metadata.avatar_url, and
       * next/image rejects any host not listed here — which took down every
       * screen that renders the profile picture, /albums included. The
       * hostname is pinned rather than wildcarded across googleusercontent
       * subdomains, since only this one serves the avatars.
       */
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        pathname: '/**',
      },
    ],
  },

  async headers() {
    return [
      {
        source: '/models/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        source: '/api/share/photos',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, max-age=0',
          },
        ],
      },
      {
        source: '/api/share/view',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, max-age=0',
          },
        ],
      },
      {
        source: '/api/photos/finalize-upload',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, max-age=0',
          },
        ],
      },
      {
        source: '/api/photos/download',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, max-age=0',
          },
        ],
      },
    ]
  },

  webpack: (config) => {
    config.externals = [...(config.externals || []), 'canvas']

    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      {
        module: /@vladmandic\/face-api/,
      },
    ]

    return config
  },
}

export default nextConfig
