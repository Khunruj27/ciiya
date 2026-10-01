import type { Metadata } from 'next'
import Link from 'next/link'
import PublicInfoDocument, { normalizePublicInfoSource, type PublicInfoSection } from '@/components/public-info-document'
import { getLocale } from '@/lib/i18n-server'

export const metadata: Metadata = {
  title: 'Support | Ciiya',
  description: 'Get help with your Ciiya account, galleries, uploads, subscriptions, and Ciiya Sync.',
  alternates: { canonical: '/support' },
}

type SupportPageProps = {
  searchParams: Promise<{ from?: string | string[] }>
}

export default async function SupportPage({ searchParams }: SupportPageProps) {
  const { from } = await searchParams
  const locale = await getLocale()
  const source = normalizePublicInfoSource(from)
  const thai = locale === 'th'
  const sections: PublicInfoSection[] = thai ? [
    {
      id: 'getting-started',
      title: 'เริ่มต้นใช้งาน',
      paragraphs: ['สมัครบัญชี สร้างอัลบั้ม แล้วอัปโหลดรูปเพื่อเริ่มแกลเลอรีแรกของคุณ เมื่อรูปประมวลผลเสร็จ คุณสามารถตั้งค่าการแชร์และส่งลิงก์ให้ลูกค้าได้ทันที'],
      items: ['ตรวจสอบอีเมลยืนยันบัญชีหลังสมัคร', 'ตั้งชื่ออัลบั้มและสิทธิ์การเข้าถึงก่อนแชร์', 'ทดลองเปิดลิงก์แชร์ในหน้าต่างส่วนตัวก่อนส่งให้ลูกค้า'],
    },
    {
      id: 'account',
      title: 'บัญชีและการเข้าสู่ระบบ',
      paragraphs: ['หากเข้าสู่ระบบไม่ได้ ให้ใช้เมนูลืมรหัสผ่านจากหน้าเข้าสู่ระบบ และตรวจสอบทั้งกล่องจดหมายหลักและจดหมายขยะ'],
      items: ['อย่าเปิดเผยรหัสผ่านหรือลิงก์รีเซ็ตรหัสผ่านให้ผู้อื่น', 'หากสงสัยว่าบัญชีถูกเข้าถึงโดยไม่ได้รับอนุญาต ให้เปลี่ยนรหัสผ่านและติดต่อเราโดยเร็ว'],
    },
    {
      id: 'albums',
      title: 'อัลบั้ม การอัปโหลด และดาวน์โหลด',
      paragraphs: ['การอัปโหลดและประมวลผลรูปอาจใช้เวลาตามขนาดไฟล์ จำนวนรูป และความเร็วอินเทอร์เน็ต หากการเชื่อมต่อขาดช่วง ระบบอาจนำรายการกลับเข้าสู่คิวโดยอัตโนมัติ'],
      items: ['คงไฟล์ต้นฉบับไว้อีกหนึ่งชุดจนกว่าจะตรวจว่ารูปขึ้นครบ', 'ตรวจพื้นที่จัดเก็บคงเหลือเมื่ออัปโหลดไม่ได้', 'หลีกเลี่ยงการเปลี่ยนชื่อหรือลบโฟลเดอร์ที่ Ciiya Sync กำลังเฝ้าดู'],
    },
    {
      id: 'sharing',
      title: 'การแชร์และค้นหารูปด้วยใบหน้า',
      paragraphs: ['เจ้าของอัลบั้มเป็นผู้ควบคุมการเผยแพร่ สิทธิ์ดาวน์โหลด รหัสผ่าน และการค้นหารูปด้วยใบหน้า โปรดส่งลิงก์เฉพาะให้ผู้ที่ควรเข้าถึงภาพ'],
      items: ['การค้นหาด้วยใบหน้าเป็นระบบช่วยค้นหา ผลลัพธ์อาจไม่สมบูรณ์', 'ควรแจ้งผู้ร่วมงานและแขกให้ทราบก่อนเปิดใช้การประมวลผลใบหน้า', 'สามารถปิดการเผยแพร่หรือเปลี่ยนสิทธิ์ได้จากการตั้งค่าอัลบั้ม'],
    },
    {
      id: 'billing',
      title: 'แพ็กเกจและการเรียกเก็บเงิน',
      paragraphs: ['จัดการแพ็กเกจ วิธีชำระเงิน และการยกเลิกได้จากหน้าบัญชีของคุณ การชำระเงินดำเนินการผ่าน Stripe และ Ciiya ไม่จัดเก็บหมายเลขบัตรเต็มของคุณ'],
      items: [<Link href="/pricing" key="pricing">ดูแพ็กเกจและพื้นที่จัดเก็บ</Link>, 'ตรวจอีเมลใบเสร็จจาก Stripe หลังการชำระเงิน', 'หากยอดเงินหรือสถานะแพ็กเกจไม่ถูกต้อง กรุณาส่งอีเมลพร้อมวันที่และอีเมลบัญชี โดยไม่ต้องส่งเลขบัตร'],
    },
    {
      id: 'contact',
      title: 'ติดต่อ Ciiya',
      paragraphs: [<>ส่งอีเมลถึง <a href="mailto:support@ciiya.app">support@ciiya.app</a> พร้อมอีเมลบัญชี ชื่ออัลบั้ม และภาพหน้าจอที่ไม่เปิดเผยรหัสผ่าน คีย์ลับ หรือข้อมูลบัตร เราจะตอบกลับโดยเร็วที่สุด</>],
      items: [<a href="mailto:support@ciiya.app?subject=Ciiya%20support%20request" key="general">ขอความช่วยเหลือทั่วไป</a>, <a href="mailto:support@ciiya.app?subject=Ciiya%20billing%20support" key="billing">ติดต่อเรื่องการเรียกเก็บเงิน</a>, <a href="mailto:support@ciiya.app?subject=Ciiya%20security%20report" key="security">รายงานเหตุการณ์ด้านความปลอดภัย</a>],
    },
  ] : [
    {
      id: 'getting-started',
      title: 'Getting started',
      paragraphs: ['Create an account, make an album, and upload photographs to begin your first gallery. Once processing is complete, configure sharing and send the link to your client.'],
      items: ['Confirm your email address after signup', 'Review album access and download permissions before sharing', 'Open the share link in a private browser window before sending it'],
    },
    {
      id: 'account',
      title: 'Account and sign-in',
      paragraphs: ['If you cannot sign in, use the password reset option on the login page and check both your inbox and spam folder.'],
      items: ['Never share your password or password-reset link', 'If you suspect unauthorized access, change your password and contact us promptly'],
    },
    {
      id: 'albums',
      title: 'Albums, uploads, and downloads',
      paragraphs: ['Upload and processing time depends on file size, image count, and connection speed. Interrupted items may be returned to the queue automatically.'],
      items: ['Keep a separate copy of originals until you confirm every image is available', 'Check remaining storage when an upload is blocked', 'Do not rename or remove a folder while Ciiya Sync is watching it'],
    },
    {
      id: 'sharing',
      title: 'Sharing and face search',
      paragraphs: ['Album owners control publishing, downloads, passwords, and face search. Share links only with people who should have access to the photographs.'],
      items: ['Face search assists discovery and may not return perfect results', 'Notify participants before enabling facial processing', 'Unpublish the album or change permissions from album settings'],
    },
    {
      id: 'billing',
      title: 'Plans and billing',
      paragraphs: ['Manage your plan, payment method, and cancellation from your account. Stripe processes payments; Ciiya does not store your full card number.'],
      items: [<Link href="/pricing" key="pricing">View plans and storage</Link>, 'Check your email for a Stripe receipt after payment', 'For incorrect charges or plan status, send the date and account email—never send card details'],
    },
    {
      id: 'contact',
      title: 'Contact Ciiya',
      paragraphs: [<>Email <a href="mailto:support@ciiya.app">support@ciiya.app</a> with your account email, album name, and a screenshot that does not expose passwords, secret keys, or card details. We will respond as soon as we can.</>],
      items: [<a href="mailto:support@ciiya.app?subject=Ciiya%20support%20request" key="general">General support</a>, <a href="mailto:support@ciiya.app?subject=Ciiya%20billing%20support" key="billing">Billing support</a>, <a href="mailto:support@ciiya.app?subject=Ciiya%20security%20report" key="security">Report a security issue</a>],
    },
  ]

  return (
    <PublicInfoDocument
      active="support"
      locale={locale}
      source={source}
      eyebrow={thai ? 'CIIYA SUPPORT' : 'CIIYA SUPPORT'}
      title={thai ? 'มีอะไรให้เราช่วยไหม?' : 'How can we help?'}
      summary={thai ? 'คำแนะนำสำหรับบัญชี อัลบั้ม การอัปโหลด Ciiya Sync การแชร์ และการเรียกเก็บเงิน พร้อมช่องทางติดต่อเมื่อคุณต้องการความช่วยเหลือเพิ่มเติม' : 'Guidance for accounts, albums, uploads, Ciiya Sync, sharing, and billing—with a direct way to reach us when you need more help.'}
      sections={sections}
    />
  )
}
