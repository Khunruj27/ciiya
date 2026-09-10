'use client'

import type { ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft, ArrowUpRight, Check } from 'lucide-react'
import { useI18n } from '@/components/i18n-provider'
import styles from './auth-shell.module.css'

type AuthShellProps = {
  mode: 'login' | 'signup'
  children: ReactNode
  eyebrow?: ReactNode
  title?: ReactNode
  introduction?: ReactNode
  switchHref?: string
  switchLabel?: ReactNode
}

export default function AuthShell({
  mode,
  children,
  eyebrow,
  title,
  introduction,
  switchHref,
  switchLabel,
}: AuthShellProps) {
  const { t, locale } = useI18n()
  const signup = mode === 'signup'
  const thai = locale === 'th'
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label={thai ? 'Ciiya หน้าหลัก' : 'Ciiya home'}><ArrowLeft size={16} aria-hidden /><span>Ciiya<span className={styles.dot}>.</span></span></Link>
        <Link href={switchHref || (signup ? '/login' : '/signup')} className={styles.switchLink}>{switchLabel || (signup ? t.signup.signIn : t.login.createAccount)}<ArrowUpRight size={15} aria-hidden /></Link>
      </header>
      <div className={styles.layout}>
        <aside className={styles.story}>
          <Image src={`/landing/${signup ? 'editorial-couple' : 'editorial-walk'}.webp`} alt={thai ? 'ภาพคู่บ่าวสาวในสวน' : 'A wedding portrait in a garden'} fill loading="eager" sizes="(max-width: 900px) 1px, 50vw" className={styles.photo} />
          <div className={styles.storyCopy}>
            <p className={styles.eyebrow}>MADE FOR YOUR MOMENTS</p>
            <h2>{thai ? 'ภาพที่มีความหมาย' : 'Meaningful photographs.'}<br />{thai ? 'คู่ควรกับพื้นที่ที่ดี' : 'A beautiful home.'}</h2>
            <p>{thai ? 'จัดเก็บภาพ ส่งมอบงาน และแบ่งปันทุกช่วงเวลาสำคัญผ่าน Ciiya' : 'Store your photographs, deliver your work, and share every important moment with Ciiya.'}</p>
            <div className={styles.benefits}>{[thai ? 'จัดเก็บต้นฉบับ' : 'Original files', thai ? 'แชร์แกลเลอรี' : 'Shared galleries', thai ? 'พอร์ตโฟลิโอของคุณ' : 'Your portfolio'].map(label => <span key={label}><Check size={14} aria-hidden />{label}</span>)}</div>
          </div>
        </aside>
        <section className={styles.formPanel}>
          <div className={styles.formContent}>
            <p className={styles.formEyebrow}>{eyebrow || (signup ? t.signup.badge : t.login.welcome)}</p>
            <h1>{title || (signup ? (thai ? 'เริ่มเก็บช่วงเวลาดี ๆ' : 'Make room for moments.') : (thai ? 'ยินดีที่ได้พบกันอีกครั้ง' : 'Good to see you again.'))}</h1>
            <p className={styles.introduction}>{introduction || (signup ? t.signup.subtitle : t.login.subtitle)}</p>
            {children}
          </div>
          <footer className={styles.footer}>Ciiya · {thai ? 'พื้นที่สำหรับทุกช่วงเวลาสำคัญ' : 'A space for every important moment'}</footer>
        </section>
      </div>
    </main>
  )
}
