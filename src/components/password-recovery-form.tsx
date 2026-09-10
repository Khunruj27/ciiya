'use client'

import { useState } from 'react'
import Link from 'next/link'
import AuthShell from '@/components/auth-shell'
import { useI18n } from '@/components/i18n-provider'
import { createClient } from '@/lib/supabase-client'

export default function PasswordRecoveryForm({
  initialError = '',
}: {
  initialError?: string
}) {
  const { locale } = useI18n()
  const thai = locale === 'th'
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(initialError)
  const [sent, setSent] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedEmail = email.trim().toLowerCase()

    if (!normalizedEmail) {
      setError(thai ? 'กรุณากรอกอีเมล' : 'Please enter your email address')
      return
    }

    setLoading(true)
    setError('')

    const supabase = createClient()
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      normalizedEmail,
      {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(
          '/reset-password'
        )}`,
      }
    )

    setLoading(false)

    if (resetError) {
      setError(
        thai
          ? 'ยังส่งลิงก์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
          : 'We could not send the reset link. Please try again.'
      )
      return
    }

    // Supabase deliberately returns the same result when an account does not
    // exist. Keep the UI equally neutral to prevent account enumeration.
    setSent(true)
  }

  return (
    <AuthShell
      mode="login"
      eyebrow={thai ? 'กู้คืนบัญชี' : 'ACCOUNT RECOVERY'}
      title={thai ? 'ตั้งรหัสผ่านใหม่' : 'Reset your password.'}
      introduction={
        thai
          ? 'กรอกอีเมลที่ใช้สมัคร เราจะส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ให้คุณ'
          : 'Enter the email used for your account and we will send you a secure reset link.'
      }
      switchHref="/login"
      switchLabel={thai ? 'กลับไปเข้าสู่ระบบ' : 'Back to sign in'}
    >
      {sent ? (
        <div className="rounded-panel border border-emerald-100 bg-emerald-50 p-5">
          <p role="status" className="text-[15px] font-medium text-emerald-800">
            {thai ? 'ตรวจสอบกล่องข้อความของคุณ' : 'Check your inbox'}
          </p>
          <p className="mt-2 text-[13px] leading-6 text-emerald-700">
            {thai
              ? 'หากอีเมลนี้มีบัญชี Ciiya คุณจะได้รับลิงก์ตั้งรหัสผ่านใหม่ในอีเมล'
              : 'If this email belongs to a Ciiya account, a password reset link will arrive shortly.'}
          </p>
          <button
            type="button"
            onClick={() => setSent(false)}
            className="mt-4 flex min-h-11 items-center text-[13px] font-semibold text-ink underline decoration-gold decoration-2 underline-offset-4"
          >
            {thai ? 'ใช้อีเมลอื่น' : 'Use another email'}
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="recovery-email" className="mb-2 block text-[13px] font-medium text-ink-soft">
              {thai ? 'อีเมล' : 'Email'}
            </label>
            <input
              id="recovery-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
              className="h-13 w-full rounded-control border border-line bg-ground px-4 text-[16px] text-ink outline-none transition placeholder:text-muted/60 focus:border-gold focus:bg-white focus:ring-4 focus:ring-gold/10"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="flex h-13 w-full items-center justify-center rounded-control bg-ink px-5 text-[15px] font-medium text-white transition hover:bg-ink-soft active:scale-[0.98] disabled:cursor-wait disabled:opacity-50"
          >
            {loading
              ? thai ? 'กำลังส่งลิงก์…' : 'Sending link…'
              : thai ? 'ส่งลิงก์ตั้งรหัสผ่านใหม่' : 'Send reset link'}
          </button>
        </form>
      )}

      {error ? (
        <p role="alert" className="mt-4 rounded-panel border border-red-100 bg-red-50 px-4 py-3 text-[13px] font-medium text-red-600">
          {error}
        </p>
      ) : null}

      <Link href="/login" className="mt-4 inline-flex min-h-11 items-center text-[13px] font-semibold text-ink underline decoration-gold decoration-2 underline-offset-4">
        {thai ? 'กลับไปเข้าสู่ระบบ' : 'Back to sign in'}
      </Link>
    </AuthShell>
  )
}
