import type { Metadata } from 'next'
import PublicInfoDocument, { normalizePublicInfoSource, type PublicInfoSection } from '@/components/public-info-document'
import { getLocale } from '@/lib/i18n-server'

export const metadata: Metadata = {
  title: 'Terms of Service | Ciiya',
  description: 'The terms that apply when you use Ciiya and its related services.',
  alternates: { canonical: '/terms' },
}

type TermsPageProps = {
  searchParams: Promise<{ from?: string | string[] }>
}

export default async function TermsPage({ searchParams }: TermsPageProps) {
  const { from } = await searchParams
  const locale = await getLocale()
  const source = normalizePublicInfoSource(from)
  const thai = locale === 'th'
  const updated = thai ? 'มีผลตั้งแต่วันที่ 1 ตุลาคม 2569' : 'Effective 1 October 2026'
  const sections: PublicInfoSection[] = thai ? [
    {
      id: 'agreement',
      title: 'การยอมรับข้อกำหนด',
      paragraphs: ['เมื่อสร้างบัญชี เข้าถึง หรือใช้ Ciiya คุณตกลงปฏิบัติตามข้อกำหนดนี้และนโยบายความเป็นส่วนตัว หากคุณใช้งานแทนบุคคลอื่น คุณยืนยันว่ามีอำนาจอนุญาตการใช้งานดังกล่าว', 'Ciiya ดำเนินการโดยผู้ให้บริการบุคคลธรรมดาในประเทศไทย ไม่ใช่นิติบุคคลหรือองค์กรที่จดทะเบียน เว้นแต่จะแจ้งการเปลี่ยนแปลงไว้ในหน้านี้'],
    },
    {
      id: 'service',
      title: 'บริการของ Ciiya',
      paragraphs: ['Ciiya ให้เครื่องมือสำหรับจัดเก็บ ประมวลผล จัดการ และส่งมอบรูปภาพ รวมถึงแกลเลอรี ลิงก์แชร์ ดาวน์โหลด พอร์ตโฟลิโอ โมเมนต์จากแขก การค้นหารูปด้วยใบหน้า Ciiya Sync และการนำเข้าจากกล้อง ฟีเจอร์บางอย่างขึ้นอยู่กับแพ็กเกจ อุปกรณ์ และพื้นที่ให้บริการ'],
    },
    {
      id: 'accounts',
      title: 'บัญชีและความปลอดภัย',
      items: ['ให้ข้อมูลที่ถูกต้องและดูแลข้อมูลบัญชีให้เป็นปัจจุบัน', 'เก็บรหัสผ่าน รหัสยืนยัน และลิงก์ที่มีสิทธิ์เข้าถึงไว้เป็นความลับ', 'รับผิดชอบกิจกรรมที่เกิดขึ้นภายใต้บัญชีของคุณ เว้นแต่เกิดจากเหตุที่ Ciiya ต้องรับผิดตามกฎหมาย', 'แจ้งเราทันทีเมื่อสงสัยว่าบัญชีถูกเข้าถึงโดยไม่ได้รับอนุญาต', 'ผู้เยาว์ควรใช้งานภายใต้ความยินยอมและการดูแลของผู้แทนโดยชอบธรรมตามกฎหมาย'],
    },
    {
      id: 'content',
      title: 'รูปภาพ เนื้อหา และสิทธิของคุณ',
      paragraphs: ['คุณยังคงเป็นเจ้าของสิทธิในรูปและเนื้อหาที่อัปโหลด คุณให้สิทธิแก่ Ciiya เท่าที่จำเป็นเพื่อจัดเก็บ สำรอง ประมวลผล แปลงขนาด แสดง ส่งมอบ และดำเนินการตามการตั้งค่าของคุณเท่านั้น'],
      items: ['คุณต้องมีสิทธิหรือได้รับอนุญาตให้อัปโหลดและเผยแพร่เนื้อหา', 'คุณต้องเคารพลิขสิทธิ์ สิทธิในภาพ ชื่อเสียง ความเป็นส่วนตัว และข้อมูลส่วนบุคคลของผู้อื่น', 'ห้ามอัปโหลดเนื้อหาผิดกฎหมาย ละเมิดสิทธิ เป็นอันตราย มีมัลแวร์ หรือใช้บริการเพื่อคุกคามบุคคลอื่น', 'คุณเป็นผู้กำหนดสิทธิ์ของลิงก์แชร์และรับผิดชอบการส่งลิงก์ให้ผู้รับที่เหมาะสม'],
    },
    {
      id: 'face-search',
      title: 'การค้นหารูปด้วยใบหน้า',
      paragraphs: ['ระบบค้นหาด้วยใบหน้าเป็นเครื่องมือช่วยค้นหา ไม่ใช่ระบบยืนยันตัวบุคคลและไม่รับประกันผลลัพธ์ที่ถูกต้องทุกครั้ง เจ้าของอัลบั้มต้องมีสิทธิหรือฐานทางกฎหมายที่เหมาะสมในการประมวลผลรูปและข้อมูลใบหน้า รวมถึงแจ้งผู้เข้าร่วมงานตามที่กฎหมายกำหนด'],
    },
    {
      id: 'plans',
      title: 'แพ็กเกจ การชำระเงิน และการต่ออายุ',
      items: ['รายละเอียดราคา พื้นที่จัดเก็บ และสิทธิของแต่ละแพ็กเกจแสดงในหน้าราคา ณ เวลาที่สมัคร', 'แพ็กเกจแบบชำระเงินต่ออายุอัตโนมัติตามรอบจนกว่าจะยกเลิก การยกเลิกโดยทั่วไปมีผลเมื่อสิ้นสุดรอบที่ชำระแล้ว', 'Stripe เป็นผู้ประมวลผลการชำระเงิน วิธีชำระเงินที่รองรับอาจเปลี่ยนตามประเทศ อุปกรณ์ และการตั้งค่าบัญชี', 'ค่าบริการ ภาษี และการคืนเงินเป็นไปตามข้อมูลที่แสดงก่อนชำระ กฎหมายที่ใช้บังคับ และเงื่อนไขของผู้ประมวลผลการชำระเงิน', 'เมื่อเกินโควตา Ciiya อาจหยุดการอัปโหลดหรือจำกัดฟีเจอร์จนกว่าจะเพิ่มพื้นที่หรือลดการใช้งาน'],
    },
    {
      id: 'availability',
      title: 'ความพร้อมใช้งานและการสำรองข้อมูล',
      paragraphs: ['เราพยายามให้บริการทำงานอย่างต่อเนื่อง แต่อาจมีการบำรุงรักษา ความล่าช้า การหยุดชะงัก หรือข้อผิดพลาดจากเครือข่าย อุปกรณ์ และผู้ให้บริการภายนอก Ciiya ไม่ใช่ระบบเก็บถาวรเพียงชุดเดียว ผู้ใช้ควรเก็บสำเนาไฟล์ต้นฉบับแยกต่างหาก'],
    },
    {
      id: 'third-parties',
      title: 'บริการของบุคคลภายนอก',
      paragraphs: ['Ciiya ใช้บริการโครงสร้างพื้นฐาน การจัดเก็บ การตรวจสอบสิทธิ์ การชำระเงิน และการประมวลผลจากบุคคลภายนอก การใช้บริการบางส่วนอาจอยู่ภายใต้เงื่อนไขของผู้ให้บริการเหล่านั้น เราไม่ควบคุมเว็บไซต์หรือลิงก์ภายนอกที่ผู้ใช้เพิ่มลงในแกลเลอรีหรือพอร์ตโฟลิโอ'],
    },
    {
      id: 'suspension',
      title: 'การระงับและการสิ้นสุดบัญชี',
      paragraphs: ['คุณสามารถหยุดใช้บริการหรือยกเลิกแพ็กเกจได้ตามช่องทางที่จัดไว้ เราอาจจำกัดหรือระงับบัญชีเมื่อมีการละเมิดข้อกำหนด ความเสี่ยงด้านความปลอดภัย การไม่ชำระค่าบริการ คำสั่งตามกฎหมาย หรือการใช้งานที่อาจสร้างความเสียหายต่อผู้อื่น โดยจะพยายามแจ้งให้ทราบเมื่อทำได้อย่างสมเหตุสมผล'],
    },
    {
      id: 'liability',
      title: 'ข้อจำกัดและความรับผิด',
      paragraphs: ['บริการจัดให้ตามสภาพที่เป็นอยู่ภายใต้ขอบเขตที่กฎหมายอนุญาต เราไม่รับประกันว่าบริการจะไม่มีข้อผิดพลาดหรือผลการค้นหาจะสมบูรณ์ ทั้งนี้ ไม่มีข้อความใดในข้อกำหนดนี้ตัดสิทธิของผู้บริโภคหรือจำกัดความรับผิดที่กฎหมายไม่อนุญาตให้จำกัด'],
    },
    {
      id: 'law-contact',
      title: 'กฎหมาย การเปลี่ยนแปลง และการติดต่อ',
      paragraphs: [<>ข้อกำหนดนี้อยู่ภายใต้กฎหมายไทย โดยคำนึงถึงสิทธิของผู้บริโภคและกฎหมายบังคับที่ใช้กับคุณ เราอาจปรับข้อกำหนดเมื่อบริการหรือกฎหมายเปลี่ยนแปลง และจะแจ้งการเปลี่ยนแปลงที่มีสาระสำคัญตามสมควร หากมีคำถาม กรุณาติดต่อ <a href="mailto:support@ciiya.app?subject=Ciiya%20terms%20question">support@ciiya.app</a></>],
    },
  ] : [
    {
      id: 'agreement',
      title: 'Agreement to these terms',
      paragraphs: ['By creating an account, accessing, or using Ciiya, you agree to these terms and the Privacy Policy. If you use Ciiya for someone else, you confirm that you have authority to do so.', 'Ciiya is operated by an individual service provider in Thailand and is not a registered company or organization unless this page is updated to say otherwise.'],
    },
    {
      id: 'service',
      title: 'The Ciiya service',
      paragraphs: ['Ciiya provides tools to store, process, manage, and deliver photographs, including galleries, share links, downloads, portfolios, guest moments, face search, Ciiya Sync, and camera import. Some features depend on your plan, device, and service availability.'],
    },
    {
      id: 'accounts',
      title: 'Accounts and security',
      items: ['Provide accurate information and keep it current', 'Keep passwords, verification codes, and privileged links confidential', 'Take responsibility for activity under your account except where law places responsibility on Ciiya', 'Notify us promptly if you suspect unauthorized access', 'Minors should use Ciiya with consent and supervision from a lawful guardian'],
    },
    {
      id: 'content',
      title: 'Photographs, content, and your rights',
      paragraphs: ['You retain ownership of your photographs and content. You grant Ciiya only the rights necessary to store, back up, process, resize, display, deliver, and follow your selected settings.'],
      items: ['You must have the right or permission to upload and publish content', 'Respect copyright, image rights, reputation, privacy, and personal data', 'Do not upload illegal, infringing, harmful, or malicious content or use Ciiya to harass others', 'You control share-link permissions and are responsible for choosing appropriate recipients'],
    },
    {
      id: 'face-search',
      title: 'Face search',
      paragraphs: ['Face search is a discovery tool, not an identity-verification system, and may return inaccurate results. Album owners must have an appropriate right or legal basis to process photographs and facial data and must notify participants where required by law.'],
    },
    {
      id: 'plans',
      title: 'Plans, payments, and renewals',
      items: ['Current plan prices, storage, and features appear on the pricing page at signup', 'Paid plans renew automatically until cancelled; cancellation generally takes effect at the end of the paid billing period', 'Stripe processes payments, and available methods may vary by country, device, and account settings', 'Fees, taxes, and refunds follow the information shown before payment, applicable law, and processor terms', 'If storage exceeds a quota, Ciiya may pause uploads or limit features until usage is reduced or capacity is increased'],
    },
    {
      id: 'availability',
      title: 'Availability and backups',
      paragraphs: ['We work to keep Ciiya available, but maintenance, delay, interruption, or errors may occur through networks, devices, and third-party providers. Ciiya is not your only archival copy; keep a separate copy of original files.'],
    },
    {
      id: 'third-parties',
      title: 'Third-party services',
      paragraphs: ['Ciiya relies on third parties for infrastructure, storage, authentication, payments, and processing. Some features are subject to their terms. We do not control external sites or links that users add to galleries or portfolios.'],
    },
    {
      id: 'suspension',
      title: 'Suspension and termination',
      paragraphs: ['You may stop using Ciiya or cancel a paid plan through the provided controls. We may restrict or suspend an account for a breach, security risk, non-payment, legal order, or use that may harm others, and will provide reasonable notice when practicable.'],
    },
    {
      id: 'liability',
      title: 'Disclaimers and liability',
      paragraphs: ['The service is provided as available to the extent permitted by law. We do not promise error-free operation or perfect search results. Nothing in these terms removes consumer rights or excludes liability that cannot legally be excluded.'],
    },
    {
      id: 'law-contact',
      title: 'Law, changes, and contact',
      paragraphs: [<>These terms are governed by Thai law, subject to mandatory consumer protections that apply to you. We may update the terms as the service or law changes and will provide reasonable notice of material changes. Questions can be sent to <a href="mailto:support@ciiya.app?subject=Ciiya%20terms%20question">support@ciiya.app</a>.</>],
    },
  ]

  return (
    <PublicInfoDocument
      active="terms"
      locale={locale}
      source={source}
      eyebrow="CIIYA TERMS"
      title={thai ? 'ชัดเจน ก่อนเริ่มแบ่งปัน' : 'Clear terms for sharing well.'}
      summary={thai ? 'ข้อกำหนดนี้วางกรอบการใช้ Ciiya อย่างรับผิดชอบ ทั้งการจัดเก็บภาพ การแชร์ การค้นหารูป แพ็กเกจ และสิทธิของเจ้าของผลงาน' : 'These terms set out responsible use of Ciiya across storage, sharing, photo discovery, subscriptions, and creators’ rights.'}
      updatedLabel={updated}
      sections={sections}
    />
  )
}
