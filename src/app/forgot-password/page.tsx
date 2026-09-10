import PasswordRecoveryForm from '@/components/password-recovery-form'
import { getLocale } from '@/lib/i18n-server'

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>
}) {
  const { error } = await searchParams
  const locale = await getLocale()
  const initialError =
    typeof error === 'string' && error === 'expired'
      ? locale === 'th'
        ? 'ลิงก์ตั้งรหัสผ่านหมดอายุหรือไม่ถูกต้อง กรุณาขอลิงก์ใหม่'
        : 'This password reset link is invalid or has expired. Request a new one.'
      : typeof error === 'string'
        ? locale === 'th'
          ? 'เปิดลิงก์ตั้งรหัสผ่านไม่สำเร็จ กรุณาขอลิงก์ใหม่'
          : 'We could not open that password reset link. Request a new one.'
        : ''

  return <PasswordRecoveryForm initialError={initialError} />
}
