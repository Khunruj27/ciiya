import { createServerSupabaseClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createServerSupabaseClient()

  const { count } = await supabase
    .from('photos')
    .select('*', { count: 'exact', head: true })

  return NextResponse.json({ total: count || 0 })
}