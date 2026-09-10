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
    hint: 'ชื่อเต็มความกว้าง ภาพหลักแนวตั้งและภาพรายละเอียดซ้อนมุม จัดจังหวะเหมือนหน้านิตยสาร',
    mood: 'สง่างาม · เล่าเรื่อง',
    category: 'ยอดนิยม',
    group: 'story',
  },
  {
    key: 'grid',
    label: 'Clean Archive',
    hint: 'ชื่อและคำแนะนำอยู่เหนือกริดสองคอลัมน์ พร้อมลำดับภาพที่เรียบง่าย เห็นผลงานได้ชัดเจนบนมือถือ',
    mood: 'โมเดิร์น · เป็นระบบ',
    category: 'ใช้งานง่าย',
    group: 'modern',
  },
  {
    key: 'masonry',
    label: 'Living Frames',
    hint: 'ภาพทรงโค้งคู่ภาพรายละเอียดสองเฟรม ตามด้วยชื่อและเรื่องราวบนพื้นโทนอุ่น',
    mood: 'อบอุ่น · มีชีวิต',
    category: 'ไลฟ์สไตล์',
    group: 'story',
  },
  {
    key: 'stack',
    label: 'Cinema One',
    hint: 'ภาพเต็มพื้นหลัง ไล่เงารองรับข้อความ พร้อมแถบภาพสามเฟรม ให้ความรู้สึกเหมือนเปิดภาพยนตร์',
    mood: 'โดดเด่น · เต็มอารมณ์',
    category: 'อีเวนต์',
    group: 'modern',
  },
  {
    key: 'minimal',
    label: 'Whitespace',
    hint: 'ภาพเดี่ยวในกรอบขาว ชื่อจัดกึ่งกลาง และพื้นที่ว่างที่พอดี ให้ผลงานโดดเด่นอย่างสงบ',
    mood: 'นิ่ง · พรีเมียม',
    category: 'มินิมอล',
    group: 'modern',
  },
  {
    key: 'split',
    label: 'Studio Profile',
    hint: 'พื้นกราไฟต์ ชื่อเต็มความกว้าง และภาพคู่ต่างสัดส่วน แยกข้อมูลชัดเจนแบบสตูดิโอมืออาชีพ',
    mood: 'มืออาชีพ · ชัดเจน',
    category: 'สตูดิโอ',
    group: 'studio',
  },
  {
    key: 'classic',
    label: 'Heritage',
    hint: 'ภาพกรอบโค้ง เส้นทองและตราอักษรย่อ จัดชื่อกึ่งกลางบนพื้นเข้มโทนอุ่นอย่างสง่างาม',
    mood: 'คลาสสิก · น่าเชื่อถือ',
    category: 'พิธีการ',
    group: 'wedding',
  },
  {
    key: 'bold',
    label: 'Creator Impact',
    hint: 'ชื่อขนาดใหญ่ ภาพหลักพร้อมภาพซ้อน และเส้นสีประจำแบรนด์ ให้บุคลิกที่มั่นใจแบบครีเอเตอร์',
    mood: 'มั่นใจ · ร่วมสมัย',
    category: 'ครีเอเตอร์',
    group: 'studio',
  },
  {
    key: 'luxe',
    label: 'Maison Romance',
    hint: 'ชื่อกึ่งกลางและภาพโค้งซ้อนกันบนพื้นสีครีม ให้บรรยากาศโรแมนติกเหมาะกับวันสำคัญ',
    mood: 'โรแมนติก · ประณีต',
    category: 'งานแต่งงาน',
    group: 'wedding',
    badge: 'แนะนำ',
  },
  {
    key: 'portrait',
    label: 'Portrait Atelier',
    hint: 'ภาพบุคคลเต็มกรอบ ตามด้วยชื่อเต็มความกว้างและภาพรายละเอียดวงกลม อ่านง่ายแบบพอร์ตสตูดิโอ',
    mood: 'มีบุคลิก · ละเมียด',
    category: 'ภาพบุคคล',
    group: 'studio',
    badge: 'ใหม่',
  },
  {
    key: 'journal',
    label: 'Field Notes',
    hint: 'พื้นกระดาษบันทึก ภาพพรินต์เอียงเล็กน้อย และภาพรายละเอียดคู่ข้อความ ให้ความรู้สึกเป็นบันทึกส่วนตัว',
    mood: 'จริงใจ · มีเรื่องราว',
    category: 'สารคดี',
    group: 'story',
    badge: 'ใหม่',
  },
  {
    key: 'noir',
    label: 'Midnight Edition',
    hint: 'ภาพขาวดำสองขนาดบนพื้นดำ ตามด้วยชื่อเต็มความกว้างและเส้นบางแบบนิตยสารแฟชั่น',
    mood: 'เข้ม · เอ็กซ์คลูซีฟ',
    category: 'แฟชั่น',
    group: 'studio',
    badge: 'ใหม่',
  },
  {
    key: 'monogram',
    label: 'Monogram House',
    hint: 'ตราอักษรย่อและชื่อกึ่งกลางเหนือภาพคู่โค้งสลับด้าน ให้ความรู้สึกเหมือนแบรนด์เฮาส์ส่วนตัว',
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
