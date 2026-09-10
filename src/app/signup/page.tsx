'use client'

import { useState } from 'react'
import AuthShell from '@/components/auth-shell'
import AuthPasswordInput from '@/components/auth-password-input'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-client'
import GoogleSignInButton from '@/components/google-sign-in-button'
import { useI18n } from '@/components/i18n-provider'

export default function SignupPage() {
  const router = useRouter()
  const { t } = useI18n()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [emailLoading, setEmailLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  async function handleEmailSignup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const normalizedEmail = email.trim().toLowerCase()

    if (!normalizedEmail) {
      setErrorMsg(t.signup.enterEmail)
      return
    }

    if (password.length < 6) {
      setErrorMsg(t.signup.passwordTooShort)
      return
    }

    if (password !== confirmPassword) {
      setErrorMsg(t.signup.passwordMismatch)
      return
    }

    setEmailLoading(true)
    setErrorMsg('')
    setSuccessMsg('')

    const supabase = createClient()
    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(
          '/albums'
        )}`,
      },
    })

    if (error) {
      setEmailLoading(false)
      setErrorMsg(error.message)
      return
    }

    if (data.session) {
      router.replace('/albums')
      router.refresh()
      return
    }

    setEmailLoading(false)
    setSuccessMsg(t.signup.checkEmail)
  }

  function handleProviderError(message: string) {
    setSuccessMsg('')
    setErrorMsg(message)
  }

  return (
    <AuthShell mode="signup">
            <form onSubmit={handleEmailSignup} className="space-y-4">
              <div>
                <label
                  htmlFor="signup-email"
                  className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.12em] text-muted"
                >
                  {t.signup.email}
                </label>
                <input
                  id="signup-email"
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

              <div className="grid gap-4">
                <div>
                  <label
                    htmlFor="signup-password"
                    className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.12em] text-muted"
                  >
                    {t.signup.password}
                  </label>
                  <AuthPasswordInput
                    id="signup-password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={t.signup.passwordHint}
                    required
                    minLength={6}
                    className="h-13 w-full rounded-control border border-line bg-ground px-4 text-[15px] text-ink outline-none transition placeholder:text-muted/60 focus:border-gold focus:bg-white focus:ring-4 focus:ring-gold/10"
                  />
                </div>

                <div>
                  <label
                    htmlFor="signup-confirm-password"
                    className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.12em] text-muted"
                  >
                    {t.signup.confirmPassword}
                  </label>
                  <AuthPasswordInput
                    id="signup-confirm-password"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder={t.signup.confirmPlaceholder}
                    required
                    minLength={6}
                    className="h-13 w-full rounded-control border border-line bg-ground px-4 text-[15px] text-ink outline-none transition placeholder:text-muted/60 focus:border-gold focus:bg-white focus:ring-4 focus:ring-gold/10"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={emailLoading}
                className="flex h-13 w-full items-center justify-center rounded-control bg-ink px-5 text-[15px] font-medium text-white transition hover:bg-ink-soft active:scale-[0.98] disabled:cursor-wait disabled:opacity-50"
              >
                {emailLoading ? t.signup.creating : t.signup.signUpEmail}
              </button>
            </form>

            <div className="my-5 flex items-center gap-3" aria-hidden="true">
              <span className="h-px flex-1 bg-line" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
                {t.signup.or}
              </span>
              <span className="h-px flex-1 bg-line" />
            </div>

            <GoogleSignInButton
              next="/albums"
              label={t.signup.signUpGoogle}
              onError={handleProviderError}
            />

            {errorMsg ? (
              <p role="alert" className="mt-4 rounded-panel border border-red-100 bg-red-50 px-4 py-3 text-[13px] font-medium text-red-600">
                {errorMsg}
              </p>
            ) : null}

            {successMsg ? (
              <p role="status" className="mt-4 rounded-panel border border-emerald-100 bg-emerald-50 px-4 py-3 text-[13px] font-medium leading-5 text-emerald-700">
                {successMsg}
              </p>
            ) : null}

            <div className="mt-4 rounded-panel bg-ground px-4 py-4 text-center">
              <p className="text-[13px] font-normal text-muted">
                {t.signup.haveAccount}
              </p>

              <Link
                href="/login"
                className="mt-2 inline-block text-[13px] font-semibold text-ink underline decoration-gold decoration-2 underline-offset-4"
              >
                {t.signup.signIn}
              </Link>
            </div>
      </AuthShell>
  )
}
