import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
      },
    ],
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