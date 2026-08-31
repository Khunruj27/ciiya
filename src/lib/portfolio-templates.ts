import type { Portfolio } from '@/lib/portfolio-types'

export type PortfolioTemplateMeta = {
  key: Portfolio['layout']
  label: string
  hint: string
  mood: string
  category: string
  group: 'wedding' | 'studio' | 'story' | 'modern'
  badge?: string
}

export const PORTFOLIO_TEMPLATES: PortfolioTemplateMeta[] = [
  {
    key: 'editorial',
    label: 'The Editorial',
    hint: 'ภาพนำขนาดใหญ่และตัวอักษรแบบนิตยสาร เหมาะกับงานที่ต้องการเล่าเรื่องอย่างมีรสนิยม',
    mood: 'สง่างาม · เล่าเรื่อง',
    category: 'ยอดนิยม',
    group: 'story',
  },
  {
    key: 'grid',
    label: 'Clean Archive',
    hint: 'เปิดด้วยกริดภาพที่เป็นระเบียบ เห็นผลงานหลากหลายและค้นหาภาพเด่นได้รวดเร็ว',
    mood: 'โมเดิร์น · เป็นระบบ',
    category: 'ใช้งานง่าย',
    group: 'modern',
  },
  {
    key: 'masonry',
    label: 'Living Frames',
    hint: 'สลับภาพแนวตั้งและแนวนอนให้เกิดจังหวะเป็นธรรมชาติ เหมาะกับงานไลฟ์สไตล์',
    mood: 'อบอุ่น · มีชีวิต',
    category: 'ไลฟ์สไตล์',
    group: 'story',
  },
  {
    key: 'stack',
    label: 'Cinema One',
    hint: 'ภาพเต็มจอและชื่อขนาดใหญ่ สร้างความประทับใจตั้งแต่เฟรมแรก',
    mood: 'โดดเด่น · เต็มอารมณ์',
    category: 'อีเวนต์',
    group: 'modern',
  },
  {
    key: 'minimal',
    label: 'Whitespace',
    hint: 'พื้นที่ว่างที่พอดี เน้นชื่อและรายละเอียด เหมาะกับงานศิลปะและสถาปัตยกรรม',
    mood: 'นิ่ง · พรีเมียม',
    category: 'มินิมอล',
    group: 'modern',
  },
  {
    key: 'split',
    label: 'Studio Profile',
    hint: 'แบ่งภาพและข้อมูลชัดเจน ให้ภาพลักษณ์มืออาชีพและติดต่อจ้างงานได้ทันที',
    mood: 'มืออาชีพ · ชัดเจน',
    category: 'สตูดิโอ',
    group: 'studio',
  },
  {
    key: 'classic',
    label: 'Heritage',
    hint: 'สมมาตร สุภาพ และเหนือกาลเวลา เหมาะกับพิธีการ งานครอบครัว และภาพทางการ',
    mood: 'คลาสสิก · น่าเชื่อถือ',
    category: 'พิธีการ',
    group: 'wedding',
  },
  {
    key: 'bold',
    label: 'Creator Impact',
    hint: 'ตัวอักษรใหญ่ สีชัด และองค์ประกอบที่มั่นใจ สำหรับแฟชั่นและครีเอเตอร์',
    mood: 'มั่นใจ · ร่วมสมัย',
    category: 'ครีเอเตอร์',
    group: 'studio',
  },
  {
    key: 'luxe',
    label: 'Maison Romance',
    hint: 'เลเยอร์ภาพอ่อนโยนในโทนอุ่น ออกแบบเพื่อพรีเวดดิ้งและวันสำคัญโดยเฉพาะ',
    mood: 'โรแมนติก · ประณีต',
    category: 'งานแต่งงาน',
    group: 'wedding',
    badge: 'แนะนำ',
  },
  {
    key: 'portrait',
    label: 'Portrait Atelier',
    hint: 'ยกภาพบุคคลแนวตั้งให้เป็นจุดเด่น พร้อมรายละเอียดแบบพอร์ตสตูดิโอระดับมืออาชีพ',
    mood: 'มีบุคลิก · ละเมียด',
    category: 'ภาพบุคคล',
    group: 'studio',
    badge: 'ใหม่',
  },
  {
    key: 'journal',
    label: 'Field Notes',
    hint: 'จัดภาพเหมือนบันทึกการเดินทาง มีหมายเลขและจังหวะเรื่องราวที่เป็นกันเอง',
    mood: 'จริงใจ · มีเรื่องราว',
    category: 'สารคดี',
    group: 'story',
    badge: 'ใหม่',
  },
  {
    key: 'noir',
    label: 'Midnight Edition',
    hint: 'พื้นหลังเข้ม ภาพคอนทราสต์สูง และเส้นสายแฟชั่นสตูดิโอที่ดูเอ็กซ์คลูซีฟ',
    mood: 'เข้ม · เอ็กซ์คลูซีฟ',
    category: 'แฟชั่น',
    group: 'studio',
    badge: 'ใหม่',
  },
  {
    key: 'monogram',
    label: 'Monogram House',
    hint: 'ภาพทรงโค้งและอักษรย่อกลางหน้า ให้บรรยากาศเหมือนแบรนด์เฮาส์สำหรับงานพิธีระดับพรีเมียม',
    mood: 'หรูหรา · เป็นส่วนตัว',
    category: 'งานแต่งงาน',
    group: 'wedding',
    badge: 'ใหม่',
  },
  {
    key: 'horizon',
    label: 'Horizon Film',
    hint: 'เปิดด้วยภาพพาโนรามากว้างและข้อความเรียบสงบ เหมาะกับท่องเที่ยว ธรรมชาติ และภาพยนตร์',
    mood: 'กว้าง · สงบนิ่ง',
    category: 'เล่าเรื่อง',
    group: 'story',
    badge: 'ใหม่',
  },
  {
    key: 'museum',
    label: 'White Museum',
    hint: 'วางผลงานเหมือนชิ้นงานในแกลเลอรีศิลปะ มีพื้นที่หายใจและรายละเอียดกำกับที่พอดี',
    mood: 'คิวเรต · สะอาด',
    category: 'ศิลปะ',
    group: 'modern',
    badge: 'ใหม่',
  },
  {
    key: 'polaroid',
    label: 'Memory Desk',
    hint: 'ภาพซ้อนแบบพรินต์บนโต๊ะบันทึก ให้ความรู้สึกเป็นกันเอง สนุก และเต็มไปด้วยความทรงจำ',
    mood: 'อบอุ่น · เป็นธรรมชาติ',
    category: 'ไลฟ์สไตล์',
    group: 'story',
    badge: 'ใหม่',
  },
  {
    key: 'duotone',
    label: 'Duotone Studio',
    hint: 'ภาพคู่บนพื้นเข้มตัดด้วยสีแบรนด์ เหมาะกับแฟชั่น โปรดักต์ และงานครีเอทีฟที่มั่นใจ',
    mood: 'กราฟิก · เด็ดขาด',
    category: 'สตูดิโอ',
    group: 'studio',
    badge: 'ใหม่',
  },
  {
    key: 'coverflow',
    label: 'Cover Flow',
    hint: 'เรียงภาพเหมือนหน้าปกคอลเลกชัน โดยภาพหลักอยู่กึ่งกลางและดึงสายตาตั้งแต่แรกเห็น',
    mood: 'แฟชั่น · ร่วมสมัย',
    category: 'ครีเอเตอร์',
    group: 'modern',
    badge: 'ใหม่',
  },
  {
    key: 'mosaic_luxe',
    label: 'Luxe Mosaic',
    hint: 'คอลลาจละเอียดบนพื้นโทนอุ่น ผสมภาพใหญ่และรายละเอียดเล็กอย่างสมดุลสำหรับวันสำคัญ',
    mood: 'ประณีต · โรแมนติก',
    category: 'งานแต่งงาน',
    group: 'wedding',
    badge: 'ใหม่',
  },
  {
    key: 'contact_sheet',
    label: 'Contact Sheet',
    hint: 'กริดภาพแบบแผ่นฟิล์มพร้อมลำดับเฟรม เหมาะกับช่างภาพสารคดีและสตูดิโอมืออาชีพ',
    mood: 'จริงจัง · ช่างภาพ',
    category: 'สารคดี',
    group: 'studio',
    badge: 'ใหม่',
  },
  {
    key: 'letterbox',
    label: 'Letterbox Cinema',
    hint: 'เฟรมภาพยนตร์แนวกว้างบนพื้นดำ พร้อมชื่อและรายละเอียดที่สงบแต่ทรงพลัง',
    mood: 'ภาพยนตร์ · ดรามาติก',
    category: 'อีเวนต์',
    group: 'modern',
    badge: 'ใหม่',
  },
  {
    key: 'sanctuary',
    label: 'Soft Sanctuary',
    hint: 'ภาพวงรีกลางพื้นที่สีอ่อนและตัวอักษรนุ่มนวล เหมาะกับครอบครัว เด็ก และงานแต่งแบบอบอุ่น',
    mood: 'อ่อนโยน · สงบ',
    category: 'ครอบครัว',
    group: 'wedding',
    badge: 'ใหม่',
  },
]

export function getPortfolioTemplate(layout: Portfolio['layout']) {
  return PORTFOLIO_TEMPLATES.find((template) => template.key === layout)
}

export function templateUsesDarkHero(layout: Portfolio['layout']) {
  return ['stack', 'split', 'classic', 'noir', 'duotone', 'contact_sheet', 'letterbox'].includes(layout)
}
