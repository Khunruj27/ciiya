'use client'

import { useState } from 'react'
import AuthShell from '@/components/auth-shell'
import AuthPasswordInput from '@/components/auth-password-input'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-client'
import GoogleSignInButton from '@/components/google-sign-in-button'
import { useI18n } from '@/components/i18n-provider'
import { getAuthErrorMessage } from '@/lib/auth-error-message'

export default function LoginForm({
  initialError = '',
  passwordReset = false,
}: {
  initialError?: string
  passwordReset?: boolean
}) {
  const router = useRouter()
  const { t, locale } = useI18n()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [emailLoading, setEmailLoading] = useState(false)
  // /auth/callback has no UI of its own, so it reports provider and
  // code-exchange failures by sending the visitor back here with ?error=.
  // The page reads it server-side and hands it down, which keeps that message
  // in the first HTML response instead of appearing only after hydration.
  const [errorMsg, setErrorMsg] = useState(initialError)

  async function handleEmailLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const normalizedEmail = email.trim().toLowerCase()

    if (!normalizedEmail || !password) {
      setErrorMsg(t.login.enterCredentials)
      return
    }

    setEmailLoading(true)
    setErrorMsg('')

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    })

    if (error) {
      setEmailLoading(false)
      setErrorMsg(getAuthErrorMessage(error, locale, 'login'))
      return
    }

    router.replace('/albums')
    router.refresh()
  }

  return (
    <AuthShell mode="login">
            <form onSubmit={handleEmailLogin} className="space-y-4">
              <div>
                <label
                  htmlFor="login-email"
                  className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.12em] text-muted"
                >
                  {t.login.email}
                </label>
                <input
                  id="login-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  required
                  className="h-13 w-full rounded-control border border-line bg-ground px-4 text-[15px] text-ink outline-none transition placeholder:text-muted/60 focus:border-gold focus:bg-white focus:ring-4 focus:ring-gold/10"
                />
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label
                    htmlFor="login-password"
                    className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted"
                  >
                    {t.login.password}
                  </label>
                  <Link href="/forgot-password" className="inline-flex min-h-11 items-center text-[12px] text-gold-deep underline-offset-4 hover:underline">{locale === 'th' ? 'ลืมรหัสผ่าน?' : 'Forgot password?'}</Link>
                </div>
                <AuthPasswordInput
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={t.login.password}
                  required
                  minLength={6}
                  className="h-13 w-full rounded-control border border-line bg-ground px-4 text-[15px] text-ink outline-none transition placeholder:text-muted/60 focus:border-gold focus:bg-white focus:ring-4 focus:ring-gold/10"
                />
              </div>

              <button
                type="submit"
                disabled={emailLoading}
                className="flex h-13 w-full items-center justify-center rounded-control bg-ink px-5 text-[15px] font-medium text-white transition hover:bg-ink-soft active:scale-[0.98] disabled:cursor-wait disabled:opacity-50"
              >
                {emailLoading ? t.login.signingIn : t.login.signInWithEmail}
              </button>
            </form>

            <div className="my-5 flex items-center gap-3" aria-hidden="true">
              <span className="h-px flex-1 bg-line" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
                {t.login.or}
              </span>
              <span className="h-px flex-1 bg-line" />
            </div>

            <GoogleSignInButton
              next="/albums"
              label={locale === 'th' ? 'เข้าสู่ระบบด้วย Google' : 'Continue with Google'}
              onError={(message) =>
                setErrorMsg(
                  message ? getAuthErrorMessage(message, locale, 'oauth') : ''
                )
              }
            />

            {errorMsg ? (
              <p role="alert" className="mt-4 rounded-panel border border-red-100 bg-red-50 px-4 py-3 text-[13px] font-medium text-red-600">
                {errorMsg}
              </p>
            ) : null}

            {passwordReset ? (
              <p role="status" className="mt-4 rounded-panel border border-emerald-100 bg-emerald-50 px-4 py-3 text-[13px] font-medium text-emerald-700">
                {locale === 'th' ? 'ตั้งรหัสผ่านใหม่สำเร็จ เข้าสู่ระบบด้วยรหัสผ่านใหม่ได้เลย' : 'Password updated. You can now sign in with your new password.'}
              </p>
            ) : null}

            <div className="mt-4 rounded-panel bg-ground px-4 py-4 text-center">
              <p className="text-[13px] font-normal text-muted">
                {t.login.noAccount}
              </p>

              <Link
                href="/signup"
                className="mt-2 inline-flex min-h-11 items-center text-[13px] font-semibold text-ink underline decoration-gold decoration-2 underline-offset-4"
              >
                {t.login.createAccount}
              </Link>
            </div>
      </AuthShell>
  )
}
