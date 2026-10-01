import type { ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft, ArrowUpRight, Mail } from 'lucide-react'
import LanguageSwitch from '@/components/language-switch'
import type { Locale } from '@/lib/i18n'
import styles from './public-info-document.module.css'

export type PublicInfoSection = {
  id: string
  title: string
  paragraphs?: ReactNode[]
  items?: ReactNode[]
}

export type PublicInfoSource = 'me' | 'login' | 'signup'

type PublicInfoDocumentProps = {
  active: 'support' | 'privacy' | 'terms'
  locale: Locale
  source?: PublicInfoSource
  eyebrow: string
  title: string
  summary: string
  updatedLabel?: string
  sections: PublicInfoSection[]
}

const SUPPORT_EMAIL = 'support@ciiya.app'

export function normalizePublicInfoSource(value: string | string[] | undefined): PublicInfoSource | undefined {
  const source = Array.isArray(value) ? value[0] : value
  return source === 'me' || source === 'login' || source === 'signup' ? source : undefined
}

export default function PublicInfoDocument({
  active,
  locale,
  source,
  eyebrow,
  title,
  summary,
  updatedLabel,
  sections,
}: PublicInfoDocumentProps) {
  const thai = locale === 'th'
  const labels = {
    support: thai ? 'ศูนย์ช่วยเหลือ' : 'Support',
    privacy: thai ? 'ความเป็นส่วนตัว' : 'Privacy',
    terms: thai ? 'ข้อกำหนด' : 'Terms',
  }
  const sourceQuery = source ? `?from=${source}` : ''
  const infoHref = (path: string) => `${path}${sourceQuery}`
  const returnLink = source === 'me'
    ? { href: '/me', label: thai ? 'โปรไฟล์' : 'Profile' }
    : source === 'login'
      ? { href: '/login', label: thai ? 'เข้าสู่ระบบ' : 'Sign in' }
      : source === 'signup'
        ? { href: '/signup', label: thai ? 'สมัครสมาชิก' : 'Sign up' }
        : { href: '/', label: thai ? 'หน้าหลัก' : 'Home' }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label={thai ? 'กลับหน้าหลัก Ciiya' : 'Ciiya home'}>
          <Image src="/logo-usage.svg" alt="Ciiya" width={100} height={38} priority />
        </Link>

        <nav className={styles.topNav} aria-label={thai ? 'ข้อมูลและความช่วยเหลือ' : 'Information and support'}>
          <Link href={infoHref('/support')} data-active={active === 'support'}>{labels.support}</Link>
          <Link href={infoHref('/privacy')} data-active={active === 'privacy'}>{labels.privacy}</Link>
          <Link href={infoHref('/terms')} data-active={active === 'terms'}>{labels.terms}</Link>
        </nav>

        <div className={styles.topActions}>
          <LanguageSwitch current={locale} />
          <Link href={returnLink.href} className={styles.back}><ArrowLeft size={15} aria-hidden />{returnLink.label}</Link>
        </div>
      </header>

      <section className={styles.hero}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1>{title}</h1>
        <p className={styles.summary}>{summary}</p>
        {updatedLabel ? <p className={styles.updated}>{updatedLabel}</p> : null}
      </section>

      <div className={styles.content}>
        <aside className={styles.side}>
          <div className={styles.sideInner}>
            <p className={styles.sideLabel}>{thai ? 'ในหน้านี้' : 'On this page'}</p>
            <nav className={styles.sideNav} aria-label={thai ? 'หัวข้อในหน้านี้' : 'Sections on this page'}>
              {sections.map((section, index) => (
                <a key={section.id} href={`#${section.id}`}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  {section.title}
                </a>
              ))}
            </nav>

            <div className={styles.sideContact}>
              <strong>{thai ? 'ยังต้องการความช่วยเหลือ?' : 'Still need help?'}</strong>
              <p>{thai ? 'ส่งรายละเอียดมาให้เรา แล้วเราจะตอบกลับโดยเร็วที่สุด' : 'Send us the details and we will respond as soon as we can.'}</p>
              <a className={styles.contactLink} href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Ciiya support request')}`}>
                <Mail size={14} aria-hidden />{SUPPORT_EMAIL}<ArrowUpRight size={13} aria-hidden />
              </a>
            </div>
          </div>
        </aside>

        <article className={styles.article}>
          {sections.map((section, index) => (
            <section className={styles.section} id={section.id} key={section.id}>
              <span className={styles.sectionNumber}>{String(index + 1).padStart(2, '0')}</span>
              <h2>{section.title}</h2>
              {section.paragraphs?.map((paragraph, paragraphIndex) => (
                <p key={paragraphIndex}>{paragraph}</p>
              ))}
              {section.items?.length ? (
                <ul>
                  {section.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}
                </ul>
              ) : null}
            </section>
          ))}
        </article>
      </div>

      <footer className={styles.footer}>
        <span>© {new Date().getFullYear()} Ciiya · {thai ? 'ดำเนินการโดยผู้ให้บริการบุคคลธรรมดาในประเทศไทย' : 'Operated by an individual service provider in Thailand'}</span>
        <div className={styles.footerLinks}>
          <Link href={infoHref('/support')}>{labels.support}</Link>
          <Link href={infoHref('/privacy')}>{labels.privacy}</Link>
          <Link href={infoHref('/terms')}>{labels.terms}</Link>
        </div>
      </footer>
    </main>
  )
}
