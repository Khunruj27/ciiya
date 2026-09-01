/**
 * Lightweight app i18n. Thai is the primary language; English is the opt-in
 * alternative chosen on the Me page. The choice lives in the `ciiya-locale`
 * cookie so server components can render the right language on first paint
 * (no flash) and the switch is one router refresh away.
 *
 * This module is import-safe from both server and client. Reading the cookie
 * on the server lives in `i18n-server.ts` (it pulls in `next/headers`).
 */

export const LOCALES = ['th', 'en'] as const
export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'th'
export const LOCALE_COOKIE = 'ciiya-locale'
// One year — the preference is sticky until the visitor changes it.
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export function normalizeLocale(value: string | null | undefined): Locale {
  return value === 'en' ? 'en' : DEFAULT_LOCALE
}

const th = {
  common: {
    viewAll: 'ดูทั้งหมด',
    signOut: 'ออกจากระบบ',
    album: 'อัลบั้ม',
    language: 'ภาษา',
    thai: 'ไทย',
    english: 'อังกฤษ',
  },
  me: {
    title: 'โปรไฟล์',
    defaultName: 'ผู้ใช้ Ciiya',
    jobs: 'งาน',
    photos: 'รูปภาพ',
    views: 'การเข้าชม',
    shares: 'การแชร์',
    storage: 'พื้นที่จัดเก็บ',
    used: 'ใช้ไป',
    left: 'เหลือ',
    upgrade: 'อัปเกรดแพ็กเกจ',
    upgradeSub: 'พื้นที่มากขึ้นสำหรับงานถ่ายภาพบ่อย ๆ',
    recentJobs: 'งานล่าสุด',
    noCover: 'ไม่มีปก',
    untitledJob: 'งานไม่มีชื่อ',
    viewsWord: 'การเข้าชม',
    sharesWord: 'การแชร์',
    noJobs: 'ยังไม่มีงาน',
    noJobsSub: 'สร้างงานแรกเพื่อเริ่มเก็บรูปภาพ',
    languageHint: 'เลือกภาษาของแอป',
  },
  login: {
    welcome: 'ยินดีต้อนรับกลับ',
    headline: 'กลับมาเก็บทุกช่วงเวลา',
    subtitle:
      'จัดการงาน อัปโหลดรูปภาพ และแชร์แกลเลอรีให้ลูกค้าได้จากที่เดียว',
    email: 'อีเมล',
    password: 'รหัสผ่าน',
    passwordHint: 'อย่างน้อย 6 ตัวอักษร',
    signingIn: 'กำลังเข้าสู่ระบบ…',
    signInWithEmail: 'เข้าสู่ระบบด้วยอีเมล',
    or: 'หรือ',
    noAccount: 'ยังไม่มีบัญชี?',
    createAccount: 'สร้างบัญชี',
    enterCredentials: 'กรุณากรอกอีเมลและรหัสผ่าน',
  },
}

const en = {
  common: {
    viewAll: 'View all',
    signOut: 'Sign out',
    album: 'Album',
    language: 'Language',
    thai: 'Thai',
    english: 'English',
  },
  me: {
    title: 'Profile',
    defaultName: 'Ciiya user',
    jobs: 'Jobs',
    photos: 'Photos',
    views: 'Views',
    shares: 'Shares',
    storage: 'Storage',
    used: 'Used',
    left: 'Left',
    upgrade: 'Upgrade plan',
    upgradeSub: 'More space for frequent shoots',
    recentJobs: 'Recent Jobs',
    noCover: 'No cover',
    untitledJob: 'Untitled job',
    viewsWord: 'views',
    sharesWord: 'shares',
    noJobs: 'No jobs yet',
    noJobsSub: 'Create your first job to start storing photos',
    languageHint: 'Choose the app language',
  },
  login: {
    welcome: 'Welcome back',
    headline: 'Come back to keep every moment',
    subtitle:
      'Manage jobs, upload photos, and share galleries with your clients from one place',
    email: 'Email',
    password: 'Password',
    passwordHint: 'At least 6 characters',
    signingIn: 'Signing in…',
    signInWithEmail: 'Sign in with email',
    or: 'or',
    noAccount: 'Don’t have an account?',
    createAccount: 'Create an account',
    enterCredentials: 'Please enter your email and password',
  },
}

export type Dictionary = typeof th

export const dictionaries: Record<Locale, Dictionary> = { th, en }

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale] ?? dictionaries[DEFAULT_LOCALE]
}
