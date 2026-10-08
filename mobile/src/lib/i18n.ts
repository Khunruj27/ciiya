import { getLocales } from 'expo-localization';

import { DataError } from '@/lib/data/types';

/**
 * Thai-first copy, matching the web app (its default locale is `th`). The
 * device language picks English when it is not Thai.
 */
const th = {
  common: {
    appName: 'Ciiya',
    retry: 'ลองอีกครั้ง',
    ok: 'ตกลง',
    cancel: 'ยกเลิก',
    save: 'บันทึก',
    saving: 'กำลังบันทึก…',
    delete: 'ลบ',
    close: 'ปิด',
    errorNetwork: 'เชื่อมต่ออินเทอร์เน็ตไม่ได้ กรุณาตรวจสอบแล้วลองใหม่',
    errorSession: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง',
    errorNotFound: 'ไม่พบข้อมูลที่ต้องการ',
    errorGeneric: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง',
  },
  signIn: {
    title: 'เข้าสู่ระบบ',
    subtitle: 'จัดการอัลบั้มและส่งมอบรูปให้ลูกค้าจากมือถือของคุณ',
    google: 'ดำเนินการต่อด้วย Google',
    or: 'หรือ',
    email: 'อีเมล',
    password: 'รหัสผ่าน',
    submit: 'เข้าสู่ระบบ',
    submitting: 'กำลังเข้าสู่ระบบ…',
    missingFields: 'กรุณากรอกอีเมลและรหัสผ่าน',
    invalidCredentials: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง กรุณาตรวจสอบแล้วลองใหม่',
    genericError: 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
    googleError: 'เข้าสู่ระบบด้วย Google ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
    notConfigured: 'แอปยังไม่ได้ตั้งค่าการเชื่อมต่อ (ดู mobile/.env.example)',
    demoNotice: 'โหมดตัวอย่าง: ใช้ข้อมูลจำลอง ไม่ต้องเข้าสู่ระบบจริง',
  },
  tabs: {
    albums: 'อัลบั้ม',
    account: 'บัญชี',
  },
  albums: {
    title: 'อัลบั้ม',
    newAlbum: 'สร้างอัลบั้ม',
    empty: 'ยังไม่มีอัลบั้ม',
    emptyHint: 'แตะ + เพื่อสร้างอัลบั้มแรกของคุณ',
    untitled: 'ไม่มีชื่ออัลบั้ม',
    photoCount: (count: number) => `${count.toLocaleString('th-TH')} รูป`,
    locked: 'มีรหัสผ่าน',
  },
  album: {
    empty: 'ยังไม่มีรูปในอัลบั้มนี้',
    emptyHint: 'แตะ + เพื่ออัปโหลดรูปจากมือถือเครื่องนี้',
    processing: 'กำลังประมวลผล',
    share: 'แชร์ลิงก์',
    settings: 'ตั้งค่า',
    shareMessage: (title: string) => `ชมรูปจากอัลบั้ม “${title}” บน Ciiya`,
  },
  viewer: {
    counter: (index: number, total: number) => `${index} / ${total}`,
    setCover: 'ตั้งเป็นปกอัลบั้ม',
    settingCover: 'กำลังตั้งปก…',
    coverSet: 'ตั้งเป็นปกแล้ว',
    coverFailed: 'ตั้งปกไม่สำเร็จ',
  },
  newAlbum: {
    title: 'อัลบั้มใหม่',
    nameLabel: 'ชื่ออัลบั้ม',
    namePlaceholder: 'เช่น งานแต่ง Air & Pleum',
    descriptionLabel: 'คำอธิบาย (ไม่บังคับ)',
    descriptionPlaceholder: 'รายละเอียดสั้น ๆ ของงาน',
    create: 'สร้าง',
    creating: 'กำลังสร้าง…',
    nameRequired: 'กรุณาตั้งชื่ออัลบั้ม',
  },
  settings: {
    title: 'ตั้งค่าอัลบั้ม',
    details: 'รายละเอียด',
    sharing: 'การแชร์',
    allowDownload: 'อนุญาตให้ดาวน์โหลด',
    downloadSize: 'ขนาดไฟล์ที่ดาวน์โหลด',
    sizes: { sd: 'SD', hd: 'HD', uhd: 'UHD', original: 'ต้นฉบับ' },
    passwordProtect: 'ตั้งรหัสผ่านเข้าชม',
    passwordNew: 'ตั้งรหัสผ่าน',
    passwordKeep: 'เว้นว่างเพื่อใช้รหัสเดิม',
    passwordRequired: 'กรุณาตั้งรหัสผ่านสำหรับอัลบั้มนี้',
    deleteAlbum: 'ลบอัลบั้ม',
    deleteTitle: 'ลบอัลบั้มนี้?',
    deleteMessage: (title: string) =>
      `“${title}” และรูปทั้งหมดในอัลบั้มจะถูกลบถาวร ไม่สามารถกู้คืนได้`,
    deleting: 'กำลังลบ…',
  },
  uploads: {
    add: 'เพิ่มรูป',
    title: 'การอัปโหลด',
    sheetTitle: (count: number) => `อัปโหลด ${count.toLocaleString('th-TH')} รูป`,
    sheetHint: 'รูปจะถูกส่งเข้าอัลบั้มนี้และเริ่มประมวลผลทันที',
    sizeLabel: 'ขนาดรูปที่ส่งมอบ',
    sizeHints: {
      sd: 'SD — ด้านยาว 2000 px',
      hd: 'HD — ด้านยาว 3000 px',
      uhd: 'UHD — ด้านยาว 4000 px',
      original: 'ต้นฉบับ — ขนาดเต็มตามไฟล์',
    },
    start: 'อัปโหลด',
    preparing: (done: number, total: number) => `กำลังเตรียมรูป ${done} / ${total}`,
    pickFailed: 'เปิดคลังรูปภาพไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
    skippedTitle: 'บางรูปไม่ได้เข้าคิว',
    skippedUnreadable: (count: number) =>
      `${count} รูปอ่านไฟล์ไม่ได้ หรือมีขนาดเกิน 200 MB`,
    skippedQueued: (count: number) => `${count} รูปอยู่ในคิวอัปโหลดอยู่แล้ว`,
    bannerUploading: (current: number, total: number) =>
      `กำลังอัปโหลด ${current} จาก ${total} รูป`,
    bannerWaiting: 'รอการเชื่อมต่อ จะอัปโหลดต่อให้อัตโนมัติ',
    bannerFailed: (count: number) => `อัปโหลดไม่สำเร็จ ${count} รูป`,
    bannerDone: (count: number) => `อัปโหลดครบ ${count} รูปแล้ว`,
    bannerAllDuplicates: (count: number) => `${count} รูปนี้มีอยู่ในอัลบั้มแล้ว ไม่ได้เพิ่มซ้ำ`,
    bannerDoneWithDuplicates: (uploaded: number, duplicates: number) =>
      `อัปโหลด ${uploaded} รูปแล้ว · มีอยู่แล้ว ${duplicates} รูป`,
    details: 'ดูรายละเอียด',
    retryAll: 'ลองใหม่ทั้งหมด',
    clearFinished: 'ล้างรายการที่เสร็จแล้ว',
    empty: 'ไม่มีรายการอัปโหลด',
    remove: 'นำออกจากคิว',
    status: {
      queued: 'รออัปโหลด',
      retrying: 'รอการเชื่อมต่อ จะลองใหม่อัตโนมัติ',
      retryingServer: 'ระบบไม่ว่างชั่วคราว จะลองใหม่อัตโนมัติ',
      uploading: (percent: number) => `กำลังอัปโหลด ${percent}%`,
      finishing: 'กำลังบันทึกเข้าอัลบั้ม…',
      done: 'อัปโหลดแล้ว',
      duplicate: 'มีรูปนี้ในอัลบั้มอยู่แล้ว',
    },
    failure: {
      network: 'เชื่อมต่อไม่ได้ แตะเพื่อลองใหม่',
      server: 'อัปโหลดไม่สำเร็จ แตะเพื่อลองใหม่',
      'storage-full': 'พื้นที่จัดเก็บเต็ม กรุณาอัปเกรดแพ็กเกจหรือลบรูปเก่า',
      session: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่ แล้วแตะเพื่อลองอีกครั้ง',
      'album-missing': 'ไม่พบอัลบั้มนี้แล้ว',
      rejected: 'ไฟล์นี้อัปโหลดไม่ได้ (รองรับ JPEG, PNG, WebP ไม่เกิน 200 MB)',
      'file-missing': 'ไม่พบไฟล์ในเครื่องแล้ว กรุณาเลือกรูปใหม่',
    },
  },
  account: {
    title: 'บัญชี',
    storage: 'พื้นที่จัดเก็บ',
    storageUsed: (used: string, limit: string) => `ใช้ไป ${used} จาก ${limit}`,
    plan: 'แพ็กเกจ',
    signOut: 'ออกจากระบบ',
    version: (version: string) => `เวอร์ชัน ${version}`,
    demo: 'โหมดตัวอย่าง',
  },
};

type Dictionary = typeof th;

const en: Dictionary = {
  common: {
    appName: 'Ciiya',
    retry: 'Try again',
    ok: 'OK',
    cancel: 'Cancel',
    save: 'Save',
    saving: 'Saving…',
    delete: 'Delete',
    close: 'Close',
    errorNetwork: 'No internet connection. Check it and try again.',
    errorSession: 'Your session has expired. Please sign in again.',
    errorNotFound: 'We could not find that.',
    errorGeneric: 'Something went wrong. Please try again.',
  },
  signIn: {
    title: 'Sign in',
    subtitle: 'Manage albums and deliver photos to clients from your phone.',
    google: 'Continue with Google',
    or: 'or',
    email: 'Email',
    password: 'Password',
    submit: 'Sign in',
    submitting: 'Signing in…',
    missingFields: 'Enter your email and password.',
    invalidCredentials: 'Incorrect email or password. Check them and try again.',
    genericError: 'Could not sign in. Please try again.',
    googleError: 'Google sign-in failed. Please try again.',
    notConfigured: 'The app is not configured yet (see mobile/.env.example).',
    demoNotice: 'Demo mode: sample data, no real sign-in needed.',
  },
  tabs: {
    albums: 'Albums',
    account: 'Account',
  },
  albums: {
    title: 'Albums',
    newAlbum: 'New album',
    empty: 'No albums yet',
    emptyHint: 'Tap + to create your first album.',
    untitled: 'Untitled album',
    photoCount: (count: number) =>
      `${count.toLocaleString('en-US')} ${count === 1 ? 'photo' : 'photos'}`,
    locked: 'Password protected',
  },
  album: {
    empty: 'No photos in this album yet',
    emptyHint: 'Tap + to upload photos from this phone.',
    processing: 'Processing',
    share: 'Share link',
    settings: 'Settings',
    shareMessage: (title: string) => `See the photos from “${title}” on Ciiya`,
  },
  viewer: {
    counter: (index: number, total: number) => `${index} / ${total}`,
    setCover: 'Set as album cover',
    settingCover: 'Setting cover…',
    coverSet: 'Cover updated',
    coverFailed: 'Could not set the cover',
  },
  newAlbum: {
    title: 'New album',
    nameLabel: 'Album name',
    namePlaceholder: 'e.g. Air & Pleum wedding',
    descriptionLabel: 'Description (optional)',
    descriptionPlaceholder: 'A short note about this job',
    create: 'Create',
    creating: 'Creating…',
    nameRequired: 'Give the album a name.',
  },
  settings: {
    title: 'Album settings',
    details: 'Details',
    sharing: 'Sharing',
    allowDownload: 'Allow downloads',
    downloadSize: 'Download size',
    sizes: { sd: 'SD', hd: 'HD', uhd: 'UHD', original: 'Original' },
    passwordProtect: 'Require a password',
    passwordNew: 'Set a password',
    passwordKeep: 'Leave blank to keep the current one',
    passwordRequired: 'Set a password for this album.',
    deleteAlbum: 'Delete album',
    deleteTitle: 'Delete this album?',
    deleteMessage: (title: string) =>
      `“${title}” and every photo in it will be permanently deleted. This cannot be undone.`,
    deleting: 'Deleting…',
  },
  uploads: {
    add: 'Add photos',
    title: 'Uploads',
    sheetTitle: (count: number) =>
      `Upload ${count.toLocaleString('en-US')} ${count === 1 ? 'photo' : 'photos'}`,
    sheetHint: 'Photos go into this album and start processing right away.',
    sizeLabel: 'Delivery size',
    sizeHints: {
      sd: 'SD — long edge 2000 px',
      hd: 'HD — long edge 3000 px',
      uhd: 'UHD — long edge 4000 px',
      original: 'Original — full size as shot',
    },
    start: 'Upload',
    preparing: (done: number, total: number) => `Preparing ${done} / ${total}`,
    pickFailed: 'Could not open the photo library. Please try again.',
    skippedTitle: 'Some photos were not queued',
    skippedUnreadable: (count: number) =>
      `${count} could not be read or ${count === 1 ? 'is' : 'are'} larger than 200 MB.`,
    skippedQueued: (count: number) =>
      `${count} ${count === 1 ? 'is' : 'are'} already in the upload queue.`,
    bannerUploading: (current: number, total: number) => `Uploading ${current} of ${total}`,
    bannerWaiting: 'Waiting for a connection. Uploads resume automatically.',
    bannerFailed: (count: number) =>
      `${count} ${count === 1 ? 'upload' : 'uploads'} failed`,
    bannerDone: (count: number) =>
      `${count} ${count === 1 ? 'photo' : 'photos'} uploaded`,
    bannerAllDuplicates: (count: number) =>
      count === 1
        ? 'This photo is already in the album. Nothing was added.'
        : `These ${count} photos are already in the album. Nothing was added.`,
    bannerDoneWithDuplicates: (uploaded: number, duplicates: number) =>
      `${uploaded} uploaded · ${duplicates} already in the album`,
    details: 'Details',
    retryAll: 'Retry all',
    clearFinished: 'Clear finished',
    empty: 'No uploads',
    remove: 'Remove from queue',
    status: {
      queued: 'Waiting to upload',
      retrying: 'Waiting for a connection. Retries automatically.',
      retryingServer: 'Server busy. Retries automatically.',
      uploading: (percent: number) => `Uploading ${percent}%`,
      finishing: 'Saving to the album…',
      done: 'Uploaded',
      duplicate: 'Already in this album',
    },
    failure: {
      network: 'No connection. Tap to retry.',
      server: 'Upload failed. Tap to retry.',
      'storage-full': 'Storage is full. Upgrade your plan or delete older photos.',
      session: 'Your session has expired. Sign in again, then tap to retry.',
      'album-missing': 'This album no longer exists.',
      rejected: 'This file cannot be uploaded (JPEG, PNG or WebP, up to 200 MB).',
      'file-missing': 'The file is no longer on this phone. Pick the photo again.',
    },
  },
  account: {
    title: 'Account',
    storage: 'Storage',
    storageUsed: (used: string, limit: string) => `${used} of ${limit} used`,
    plan: 'Plan',
    signOut: 'Sign out',
    version: (version: string) => `Version ${version}`,
    demo: 'Demo mode',
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

/** Customer-facing copy for a failed read or write. */
export function describeError(t: Dictionary, error: unknown): string {
  if (error instanceof DataError) {
    if (error.kind === 'network') return t.common.errorNetwork;
    if (error.kind === 'unauthenticated') return t.common.errorSession;
    if (error.kind === 'not-found') return t.common.errorNotFound;
  }
  return t.common.errorGeneric;
}
