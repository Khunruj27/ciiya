import LoginForm from '@/components/login-form'

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
  const { error } = await searchParams
  const initialError = typeof error === 'string' ? error : ''

  return <LoginForm initialError={initialError} />
}
