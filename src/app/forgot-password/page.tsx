import { redirect } from 'next/navigation'

/*
 * There are no passwords to recover: the Supabase email provider is disabled
 * and every account signs in through Google. Left as-is this page would ask
 * for an address and then fail with "Email logins are disabled", so it sends
 * people to the one door that works instead. Kept as a route rather than
 * deleted so older links and bookmarks still land somewhere useful.
 */
export default function ForgotPasswordPage() {
  redirect('/login')
}
