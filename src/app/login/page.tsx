import LoginForm from '@/components/login-form'
import { getAuthErrorMessage } from '@/lib/auth-error-message'
import { getLocale } from '@/lib/i18n-server'

/*
 * A server component so the form ships in the first HTML response. Reading
 * ?error= with useSearchParams instead would opt the whole page out of server
 * rendering, which shipped a login page whose HTML carried none of the form.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { error, reset } = await searchParams
  const locale = await getLocale()
  const initialError =
    typeof error === 'string' ? getAuthErrorMessage(error, locale, 'oauth') : ''

  return <LoginForm initialError={initialError} passwordReset={reset === 'success'} />
}
