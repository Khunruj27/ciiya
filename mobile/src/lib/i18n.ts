import { getLocales } from 'expo-localization';

/**
 * Thai-first copy, matching the web app (its default locale is `th`). The
 * device language picks English when it is not Thai.
 */
const th = {
  common: {
    appName: 'Ciiya',
    retry: 'ลองอีกครั้ง',
    signOut: 'ออกจากระบบ',
    loading: 'กำลังโหลด…',
  },
  signIn: {
    title: 'เข้าสู่ระบบ',
    subtitle: 'จัดการอัลบั้มและส่งมอบรูปให้ลูกค้าจากมือถือของคุณ',
    email: 'อีเมล',
    password: 'รหัสผ่าน',
    submit: 'เข้าสู่ระบบ',
    submitting: 'กำลังเข้าสู่ระบบ…',
    missingFields: 'กรุณากรอกอีเมลและรหัสผ่าน',
    invalidCredentials: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง กรุณาตรวจสอบแล้วลองใหม่',
    genericError: 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
    notConfigured: 'แอปยังไม่ได้ตั้งค่าการเชื่อมต่อ (ดู mobile/.env.example)',
  },
  albums: {
    title: 'อัลบั้ม',
    empty: 'ยังไม่มีอัลบั้ม',
    emptyHint: 'สร้างอัลบั้มแรกของคุณได้จากเว็บไซต์ Ciiya',
    loadError: 'โหลดอัลบั้มไม่สำเร็จ',
    untitled: 'ไม่มีชื่ออัลบั้ม',
    photoCount: (count: number) => `${count} รูป`,
  },
  album: {
    empty: 'ยังไม่มีรูปในอัลบั้มนี้',
    loadError: 'โหลดรูปไม่สำเร็จ',
    processing: 'กำลังประมวลผล',
  },
};

type Dictionary = typeof th;

const en: Dictionary = {
  common: {
    appName: 'Ciiya',
    retry: 'Try again',
    signOut: 'Sign out',
    loading: 'Loading…',
  },
  signIn: {
    title: 'Sign in',
    subtitle: 'Manage albums and deliver photos to clients from your phone.',
    email: 'Email',
    password: 'Password',
    submit: 'Sign in',
    submitting: 'Signing in…',
    missingFields: 'Enter your email and password.',
    invalidCredentials: 'Incorrect email or password. Check them and try again.',
    genericError: 'Could not sign in. Please try again.',
    notConfigured: 'The app is not configured yet (see mobile/.env.example).',
  },
  albums: {
    title: 'Albums',
    empty: 'No albums yet',
    emptyHint: 'Create your first album on the Ciiya website.',
    loadError: 'Could not load albums',
    untitled: 'Untitled album',
    photoCount: (count: number) => `${count} ${count === 1 ? 'photo' : 'photos'}`,
  },
  album: {
    empty: 'No photos in this album yet',
    loadError: 'Could not load photos',
    processing: 'Processing',
  },
};

export type Locale = 'th' | 'en';

export function getDeviceLocale(): Locale {
  const language = getLocales()[0]?.languageCode;
  return language === 'th' || !language ? 'th' : 'en';
}

const dictionaries: Record<Locale, Dictionary> = { th, en };

export function getDictionary(locale: Locale = getDeviceLocale()): Dictionary {
  return dictionaries[locale];
}

/** Device-locale dictionary. Locale is fixed for the app session. */
export function useT(): Dictionary {
  return getDictionary();
}
