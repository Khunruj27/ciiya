import type { Metadata } from 'next'
import PublicInfoDocument, { normalizePublicInfoSource, type PublicInfoSection } from '@/components/public-info-document'
import { getLocale } from '@/lib/i18n-server'

export const metadata: Metadata = {
  title: 'Privacy Policy | Ciiya',
  description: 'How Ciiya collects, uses, protects, and shares personal data.',
  alternates: { canonical: '/privacy' },
}

type PrivacyPageProps = {
  searchParams: Promise<{ from?: string | string[] }>
}

export default async function PrivacyPage({ searchParams }: PrivacyPageProps) {
  const { from } = await searchParams
  const locale = await getLocale()
  const source = normalizePublicInfoSource(from)
  const thai = locale === 'th'
  const updated = thai ? 'มีผลตั้งแต่วันที่ 1 ตุลาคม 2569' : 'Effective 1 October 2026'
  const sections: PublicInfoSection[] = thai ? [
    {
      id: 'scope',
      title: 'ขอบเขตและผู้ควบคุมข้อมูล',
      paragraphs: ['นโยบายนี้อธิบายวิธีที่ Ciiya ซึ่งดำเนินการโดยผู้ให้บริการบุคคลธรรมดาในประเทศไทย เก็บ ใช้ เปิดเผย และดูแลข้อมูลส่วนบุคคลเมื่อคุณใช้เว็บไซต์ แอป แกลเลอรีสาธารณะ Ciiya Sync และบริการที่เกี่ยวข้อง', 'เจ้าของอัลบั้มอาจเป็นผู้กำหนดวัตถุประสงค์ของการเก็บและเผยแพร่รูปภาพของบุคคลในงาน ส่วน Ciiya ประมวลผลข้อมูลเพื่อให้บริการตามคำสั่งและการตั้งค่าของเจ้าของอัลบั้ม'],
    },
    {
      id: 'collection',
      title: 'ข้อมูลที่เราเก็บ',
      items: ['ข้อมูลบัญชี เช่น อีเมล ชื่อที่แสดง ภาษา และข้อมูลยืนยันตัวตนที่จำเป็น', 'รูปภาพ วิดีโอ ข้อมูลไฟล์ เมทาดาทา อัลบั้ม พอร์ตโฟลิโอ โมเมนต์จากแขก และการตั้งค่าการแชร์', 'ข้อมูลใบหน้าและตัวแทนเชิงคณิตศาสตร์ที่สร้างจากภาพ เมื่อเจ้าของอัลบั้มเปิดใช้การค้นหารูปด้วยใบหน้า', 'ข้อมูลการใช้บริการ เช่น อุปกรณ์ เบราว์เซอร์ ที่อยู่ IP บันทึกเหตุการณ์ การดาวน์โหลด การกดหัวใจ และข้อมูลวิเคราะห์', 'ข้อมูลการสมัครสมาชิก สถานะแพ็กเกจ ใบเสร็จ และตัวระบุธุรกรรมจากผู้ให้บริการชำระเงิน โดย Ciiya ไม่เก็บหมายเลขบัตรเต็ม', 'ข้อมูลจาก Ciiya Sync และ Camera Live Import เช่น โฟลเดอร์ที่เลือก สถานะคิว ชื่อไฟล์ และผลการอัปโหลด'],
    },
    {
      id: 'use',
      title: 'วัตถุประสงค์และฐานการประมวลผล',
      items: ['ให้บริการบัญชี พื้นที่จัดเก็บ การประมวลผลรูป การแชร์ ดาวน์โหลด พอร์ตโฟลิโอ และการค้นหารูป', 'ดำเนินการตามสัญญา จัดการแพ็กเกจ โควตาพื้นที่ และการสนับสนุนลูกค้า', 'รักษาความปลอดภัย ป้องกันการฉ้อโกง ตรวจสอบข้อผิดพลาด และดูแลความเสถียรของระบบ', 'ส่งการแจ้งเตือนที่เกี่ยวข้องกับบริการ และสื่อสารเมื่อมีการเปลี่ยนแปลงสำคัญ', 'ปฏิบัติตามกฎหมาย คำสั่งของหน่วยงานรัฐ และสิทธิอันชอบด้วยกฎหมายของเราและผู้ใช้', 'ขอความยินยอมในกรณีที่กฎหมายกำหนด รวมถึงการประมวลผลข้อมูลที่มีความอ่อนไหวบางประเภท'],
    },
    {
      id: 'face-data',
      title: 'การค้นหารูปและข้อมูลใบหน้า',
      paragraphs: ['Ciiya ใช้การประมวลผลใบหน้าเพื่อช่วยจับคู่ภาพค้นหากับรูปในอัลบั้มที่เกี่ยวข้องเท่านั้น ผลลัพธ์เป็นการคาดคะเนและอาจคลาดเคลื่อน เราไม่ใช้ข้อมูลดังกล่าวเพื่อโฆษณา ให้คะแนนบุคคล หรือขายให้บุคคลภายนอก', 'เจ้าของอัลบั้มมีหน้าที่แจ้งผู้เข้าร่วมงานและขอความยินยอมหรือมีฐานทางกฎหมายที่เหมาะสมก่อนเปิดใช้ฟีเจอร์นี้ ผู้ค้นหาควรใช้ภาพของตนเองหรือภาพที่ได้รับอนุญาต'],
    },
    {
      id: 'sharing',
      title: 'การเปิดเผยและผู้ประมวลผลข้อมูล',
      paragraphs: ['เราเปิดเผยข้อมูลเท่าที่จำเป็นแก่เจ้าของอัลบั้ม ผู้ชมที่ได้รับสิทธิ์ ผู้ให้บริการโครงสร้างพื้นฐาน การจัดเก็บ การประมวลผล การชำระเงิน อีเมล การวิเคราะห์ และการสนับสนุน ซึ่งอาจรวมถึง Supabase, Cloudflare, Vercel, Railway และ Stripe ตามบริการที่ใช้งาน'],
      items: ['เมื่อคุณเผยแพร่ลิงก์ แกลเลอรีหรือข้อมูลที่ตั้งเป็นสาธารณะอาจเข้าถึงได้โดยผู้ที่ได้รับลิงก์', 'ผู้ให้บริการอาจประมวลผลข้อมูลในต่างประเทศภายใต้ข้อตกลงและมาตรการคุ้มครองที่เกี่ยวข้อง', 'เราอาจเปิดเผยข้อมูลเมื่อกฎหมายกำหนด เพื่อป้องกันอันตราย หรือเพื่อปกป้องสิทธิและความปลอดภัยของบริการ'],
    },
    {
      id: 'retention',
      title: 'ระยะเวลาการเก็บและการลบ',
      paragraphs: ['เราเก็บข้อมูลเท่าที่จำเป็นต่อการให้บริการ ปฏิบัติตามกฎหมาย แก้ไขข้อพิพาท และรักษาความปลอดภัย ระยะเวลาอาจแตกต่างตามประเภทข้อมูล สถานะบัญชี และการตั้งค่าของเจ้าของอัลบั้ม', 'เมื่อมีการลบรูป อัลบั้ม หรือบัญชี ข้อมูลอาจยังอยู่ในระบบสำรองหรือคิวประมวลผลชั่วคราวก่อนถูกลบตามรอบการดำเนินงานและข้อกำหนดทางกฎหมาย'],
    },
    {
      id: 'security',
      title: 'การรักษาความปลอดภัย',
      paragraphs: ['เราใช้มาตรการด้านเทคนิคและการจัดการตามสมควร เช่น การควบคุมสิทธิ์ การเข้ารหัสระหว่างรับส่งข้อมูล URL ที่มีอายุจำกัด การตรวจสอบเจ้าของข้อมูล และการบันทึกเหตุการณ์ อย่างไรก็ตาม ไม่มีระบบออนไลน์ใดปลอดภัยได้อย่างสมบูรณ์ ผู้ใช้ควรตั้งรหัสผ่านที่คาดเดายากและดูแลลิงก์แชร์ของตน'],
    },
    {
      id: 'rights',
      title: 'สิทธิของเจ้าของข้อมูล',
      paragraphs: ['ภายใต้กฎหมายที่ใช้บังคับ คุณอาจมีสิทธิขอเข้าถึง แก้ไข ลบ จำกัดหรือคัดค้านการประมวลผล ขอรับหรือโอนข้อมูล ถอนความยินยอม และร้องเรียนต่อหน่วยงานกำกับดูแล สิทธิบางประการอาจมีข้อจำกัดตามกฎหมายหรือสิทธิของบุคคลอื่น'],
      items: ['สำหรับข้อมูลบัญชีของคุณ โปรดติดต่อ Ciiya', 'สำหรับรูปหรือข้อมูลที่เผยแพร่โดยช่างภาพหรือเจ้าของงาน โปรดติดต่อเจ้าของอัลบั้มก่อน เพราะบุคคลดังกล่าวเป็นผู้กำหนดการเผยแพร่', 'เราจะขอตรวจสอบตัวตนก่อนดำเนินการตามคำขอที่เกี่ยวข้องกับข้อมูลส่วนบุคคล'],
    },
    {
      id: 'cookies',
      title: 'คุกกี้และเทคโนโลยีที่คล้ายกัน',
      paragraphs: ['เราใช้คุกกี้และที่จัดเก็บในอุปกรณ์ที่จำเป็นต่อการเข้าสู่ระบบ ความปลอดภัย ภาษา และการทำงานของบริการ รวมถึงข้อมูลวิเคราะห์เพื่อทำความเข้าใจประสิทธิภาพ คุณสามารถจำกัดคุกกี้ผ่านเบราว์เซอร์ได้ แต่บางฟีเจอร์อาจใช้งานไม่ได้'],
    },
    {
      id: 'changes-contact',
      title: 'การเปลี่ยนแปลงและการติดต่อ',
      paragraphs: [<>เราอาจปรับนโยบายนี้เมื่อบริการหรือกฎหมายเปลี่ยนแปลง และจะแสดงวันที่มีผลฉบับล่าสุดในหน้านี้ หากมีคำถามหรือคำขอเกี่ยวกับข้อมูลส่วนบุคคล กรุณาติดต่อ <a href="mailto:support@ciiya.app?subject=Ciiya%20privacy%20request">support@ciiya.app</a></>],
    },
  ] : [
    {
      id: 'scope',
      title: 'Scope and controller',
      paragraphs: ['This policy explains how Ciiya, operated by an individual service provider in Thailand, collects, uses, discloses, and protects personal data across the website, application, public galleries, Ciiya Sync, and related services.', 'Album owners may determine why photographs of event participants are collected and shared. Ciiya processes that data to provide the service according to the owner’s instructions and settings.'],
    },
    {
      id: 'collection',
      title: 'Data we collect',
      items: ['Account data such as email, display name, language, and required verification details', 'Photographs, videos, file metadata, albums, portfolios, guest moments, and sharing settings', 'Facial data and mathematical representations generated from images when an album owner enables face search', 'Usage information such as device, browser, IP address, event logs, downloads, hearts, and analytics', 'Subscription status, plan, receipt, and transaction identifiers from payment providers; Ciiya does not store full card numbers', 'Ciiya Sync and Camera Live Import information such as selected folders, queue status, filenames, and upload results'],
    },
    {
      id: 'use',
      title: 'Purposes and legal bases',
      items: ['Provide accounts, storage, image processing, sharing, downloads, portfolios, and photo discovery', 'Perform our agreement and manage subscriptions, storage quotas, and customer support', 'Secure the service, prevent fraud, diagnose errors, and maintain reliability', 'Send service notifications and communicate significant changes', 'Comply with law, government orders, and the legitimate rights of Ciiya and its users', 'Obtain consent where required, including for certain sensitive data processing'],
    },
    {
      id: 'face-data',
      title: 'Face search and facial data',
      paragraphs: ['Ciiya processes facial data only to help match a search image with photographs in the relevant album. Results are probabilistic and may be inaccurate. We do not use facial data for advertising, scoring people, or sale to third parties.', 'Album owners must notify participants and obtain consent or another appropriate legal basis before enabling this feature. A person searching should use their own image or one they are authorized to use.'],
    },
    {
      id: 'sharing',
      title: 'Sharing and processors',
      paragraphs: ['We disclose data as necessary to album owners, authorized viewers, and providers of infrastructure, storage, processing, payments, email, analytics, and support. Depending on the feature, these providers may include Supabase, Cloudflare, Vercel, Railway, and Stripe.'],
      items: ['A gallery or information made public may be accessed by anyone who receives its link', 'Providers may process data in other countries under applicable agreements and safeguards', 'We may disclose data when required by law, to prevent harm, or to protect the service and its users'],
    },
    {
      id: 'retention',
      title: 'Retention and deletion',
      paragraphs: ['We retain information for as long as necessary to provide the service, comply with law, resolve disputes, and maintain security. Retention varies with the data type, account status, and album settings.', 'Deleted photographs, albums, or accounts may remain temporarily in backups or processing queues until removed through operational cycles and legal retention requirements.'],
    },
    {
      id: 'security',
      title: 'Security',
      paragraphs: ['We use reasonable technical and organizational controls, including access control, encryption in transit, expiring URLs, ownership checks, and event logging. No online service is completely secure; use a strong password and protect your share links.'],
    },
    {
      id: 'rights',
      title: 'Your rights',
      paragraphs: ['Subject to applicable law, you may request access, correction, deletion, restriction, objection, portability, withdrawal of consent, or lodge a complaint with a regulator. Some rights are limited by law or the rights of others.'],
      items: ['Contact Ciiya for information tied to your account', 'For photographs published by a photographer or event owner, contact the album owner first because they control publication', 'We will verify identity before acting on a personal-data request'],
    },
    {
      id: 'cookies',
      title: 'Cookies and similar technologies',
      paragraphs: ['We use device storage and cookies necessary for sign-in, security, language, and service functionality, along with analytics that help us understand performance. Blocking cookies may cause some features to stop working.'],
    },
    {
      id: 'changes-contact',
      title: 'Changes and contact',
      paragraphs: [<>We may update this policy as the service or law changes and will show the current effective date here. For privacy questions or requests, email <a href="mailto:support@ciiya.app?subject=Ciiya%20privacy%20request">support@ciiya.app</a>.</>],
    },
  ]

  return (
    <PublicInfoDocument
      active="privacy"
      locale={locale}
      source={source}
      eyebrow="PRIVACY AT CIIYA"
      title={thai ? 'ภาพของคุณ ข้อมูลของคุณ' : 'Your photographs. Your data.'}
      summary={thai ? 'เราออกแบบ Ciiya ให้ช่วยจัดเก็บ ส่งมอบ และค้นหารูปได้อย่างรับผิดชอบ นโยบายนี้อธิบายว่าข้อมูลใดถูกใช้ เพราะเหตุใด และคุณควบคุมข้อมูลได้อย่างไร' : 'Ciiya is designed to store, deliver, and discover photographs responsibly. This policy explains what data is used, why it is used, and the choices available to you.'}
      updatedLabel={updated}
      sections={sections}
    />
  )
}
