import { redirect } from 'next/navigation'
import PasswordResetForm from '@/components/password-reset-form'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export default async function ResetPasswordPage() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/forgot-password?error=expired')

  return <PasswordResetForm />
}
