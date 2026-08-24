import { redirect } from 'next/navigation'

/*
 * The destination of password-reset emails, which are no longer sent — the
 * Supabase email provider is disabled and every account signs in through
 * Google. Kept as a route rather than deleted so any reset link still in
 * someone's inbox lands on the working sign-in page instead of a 404.
 */
export default function ResetPasswordPage() {
  redirect('/login')
}
