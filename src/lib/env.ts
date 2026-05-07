const requiredEnv = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
]

if (process.env.NODE_ENV === 'production') {
  requiredEnv.push(
    'WORKER_SECRET',
    'NEXT_PUBLIC_SITE_URL'
  )
}

for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
}

export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  workerSecret: process.env.WORKER_SECRET,
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
}