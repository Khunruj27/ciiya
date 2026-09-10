import type { Locale } from '@/lib/i18n'

export type AuthErrorContext = 'login' | 'signup' | 'oauth'

function errorText(error: unknown) {
  if (typeof error === 'string') return error
  if (!error || typeof error !== 'object') return ''

  const value = error as { code?: unknown; message?: unknown }
  return `${String(value.code || '')} ${String(value.message || '')}`.trim()
}

/**
 * Converts provider errors into stable, localized copy. Provider messages can
 * change and should never be exposed directly to customers.
 */
export function getAuthErrorMessage(
  error: unknown,
  locale: Locale,
  context: AuthErrorContext
) {
  const value = errorText(error).toLowerCase()
  const thai = locale === 'th'

  if (
    value.includes('invalid_credentials') ||
    value.includes('invalid login credentials')
  ) {
    return thai
      ? 'อีเมลหรือรหัสผ่านไม่ถูกต้อง กรุณาตรวจสอบแล้วลองใหม่'
      : 'The email or password is incorrect. Please check and try again.'
  }

  if (value.includes('email_not_confirmed') || value.includes('email not confirmed')) {
    return thai
      ? 'กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ'
      : 'Please confirm your email before signing in.'
  }

  if (
    value.includes('user_already_exists') ||
    value.includes('already registered') ||
    value.includes('already exists')
  ) {
    return thai
      ? 'อีเมลนี้มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบหรือรีเซ็ตรหัสผ่าน'
      : 'An account already uses this email. Sign in or reset your password.'
  }

  if (value.includes('weak_password') || value.includes('password should be')) {
    return thai
      ? 'รหัสผ่านยังไม่ปลอดภัย กรุณาใช้รหัสผ่านที่ยาวและคาดเดายากขึ้น'
      : 'Please choose a longer, harder-to-guess password.'
  }

  if (
    value.includes('over_email_send_rate_limit') ||
    value.includes('rate limit') ||
    value.includes('too many requests')
  ) {
    return thai
      ? 'มีการขอใช้งานหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่'
      : 'There have been too many attempts. Please wait a moment and try again.'
  }

  if (value.includes('email_address_invalid') || value.includes('invalid email')) {
    return thai
      ? 'รูปแบบอีเมลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง'
      : 'That email address does not look valid. Please check it.'
  }

  if (
    value.includes('signup_disabled') ||
    value.includes('provider_disabled') ||
    value.includes('provider is not enabled')
  ) {
    return thai
      ? 'ช่องทางสมัครหรือเข้าสู่ระบบนี้ยังไม่พร้อมใช้งาน'
      : 'This sign-up or sign-in method is not available right now.'
  }

  if (
    value.includes('failed to fetch') ||
    value.includes('fetch failed') ||
    value.includes('network')
  ) {
    return thai
      ? 'เชื่อมต่อระบบไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่'
      : 'We could not connect. Check your internet connection and try again.'
  }

  if (context === 'signup') {
    return thai
      ? 'สร้างบัญชีไม่สำเร็จ กรุณาตรวจสอบข้อมูลแล้วลองใหม่'
      : 'We could not create the account. Check your details and try again.'
  }

  if (context === 'oauth') {
    return thai
      ? 'เข้าสู่ระบบด้วย Google ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
      : 'Google sign-in did not complete. Please try again.'
  }

  return thai
    ? 'เข้าสู่ระบบไม่สำเร็จ กรุณาตรวจสอบข้อมูลแล้วลองใหม่'
    : 'We could not sign you in. Check your details and try again.'
}
