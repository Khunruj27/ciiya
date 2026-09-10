'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import AuthPasswordInput from '@/components/auth-password-input'
import AuthShell from '@/components/auth-shell'
import { useI18n } from '@/components/i18n-provider'
import { createClient } from '@/lib/supabase-client'

export default function PasswordResetForm() {
  const router = useRouter()
  const { locale } = useI18n()
  const thai = locale === 'th'
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (password.length < 6) {
      setError(thai ? 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' : 'Password must be at least 6 characters')
      return
    }

    if (password !== confirmation) {
      setError(thai ? 'รหัสผ่านทั้งสองช่องไม่ตรงกัน' : 'Passwords do not match')
      return
    }

    setLoading(true)
    setError('')

    const supabase = createClient()
    const { error: updateError } = await supabase.auth.updateUser({ password })

    if (updateError) {
      setLoading(false)
      setError(
        thai
          ? 'ลิงก์อาจหมดอายุหรือตั้งรหัสผ่านไม่สำเร็จ กรุณาขอลิงก์ใหม่'
          : 'This link may have expired or the password could not be updated. Request a new link.'
      )
      return
    }

    await supabase.auth.signOut()
    router.replace('/login?reset=success')
    router.refresh()
  }

  return (
    <AuthShell
      mode="login"
      eyebrow={thai ? 'ความปลอดภัยของบัญชี' : 'ACCOUNT SECURITY'}
      title={thai ? 'สร้างรหัสผ่านใหม่' : 'Create a new password.'}
      introduction={thai ? 'ตั้งรหัสผ่านใหม่สำหรับบัญชี Ciiya ของคุณ' : 'Choose a new password for your Ciiya account.'}
      switchHref="/login"
      switchLabel={thai ? 'กลับไปเข้าสู่ระบบ' : 'Back to sign in'}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="new-password" className="mb-2 block text-[13px] font-medium text-ink-soft">
            {thai ? 'รหัสผ่านใหม่' : 'New password'}
          </label>
          <AuthPasswordInput
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={thai ? 'อย่างน้อย 6 ตัวอักษร' : 'At least 6 characters'}
            required
            minLength={6}
            className="h-13 w-full rounded-control border border-line bg-ground px-4 text-[16px] text-ink outline-none transition placeholder:text-muted/60 focus:border-gold focus:bg-white focus:ring-4 focus:ring-gold/10"
          />
        </div>
        <div>
          <label htmlFor="confirm-new-password" className="mb-2 block text-[13px] font-medium text-ink-soft">
            {thai ? 'ยืนยันรหัสผ่านใหม่' : 'Confirm new password'}
          </label>
          <AuthPasswordInput
            id="confirm-new-password"
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder={thai ? 'กรอกรหัสผ่านอีกครั้ง' : 'Enter it again'}
            required
            minLength={6}
            className="h-13 w-full rounded-control border border-line bg-ground px-4 text-[16px] text-ink outline-none transition placeholder:text-muted/60 focus:border-gold focus:bg-white focus:ring-4 focus:ring-gold/10"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="flex h-13 w-full items-center justify-center rounded-control bg-ink px-5 text-[15px] font-medium text-white transition hover:bg-ink-soft active:scale-[0.98] disabled:cursor-wait disabled:opacity-50"
        >
          {loading
            ? thai ? 'กำลังบันทึก…' : 'Saving…'
            : thai ? 'บันทึกรหัสผ่านใหม่' : 'Save new password'}
        </button>
      </form>
      {error ? (
        <p role="alert" className="mt-4 rounded-panel border border-red-100 bg-red-50 px-4 py-3 text-[13px] font-medium text-red-600">
          {error}
        </p>
      ) : null}
    </AuthShell>
  )
}
