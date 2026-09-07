import 'server-only'

export type AlbumInsightSnapshot = {
  albumTitle: string
  isPublic: boolean
  hasCover: boolean
  photoCount: number
  galleryViews: number
  recentViews: number
  previousWeekViews: number
  currentWeekViews: number
  downloads: number
  hearts: number
  faceSearches: number
  guestMoments: number
  photoOpens: number
  peakHour: number | null
  topPhoto: {
    id: string
    filename: string
    score: number
    views: number
    downloads: number
    hearts: number
  } | null
}

export type AlbumInsightRecommendation = {
  id: string
  priority: 'high' | 'medium' | 'low'
  title: string
  detail: string
  actionLabel?: string
  actionHref?: string
}

export type AlbumInsightResult = {
  version: 'ciiya-insights-v1'
  generatedAt: string
  summary: string
  health: 'เริ่มต้น' | 'พร้อมแชร์' | 'กำลังเติบโต' | 'มีส่วนร่วมสูง'
  highlights: string[]
  recommendations: AlbumInsightRecommendation[]
  notificationDraft: {
    title: string
    summary: string
  } | null
  privacy: string
  snapshot: AlbumInsightSnapshot
}

const number = new Intl.NumberFormat('th-TH')

function growthPercent(current: number, previous: number) {
  if (previous <= 0) return current > 0 ? 100 : 0
  return Math.round(((current - previous) / previous) * 100)
}

function hourRange(hour: number | null) {
  if (hour === null) return null
  return `${String(hour).padStart(2, '0')}:00–${String((hour + 1) % 24).padStart(2, '0')}:00 น.`
}

export function buildAlbumInsights(snapshot: AlbumInsightSnapshot): AlbumInsightResult {
  const totalEngagement = snapshot.downloads + snapshot.hearts + snapshot.faceSearches + snapshot.guestMoments
  const interactionRate = snapshot.recentViews > 0
    ? Math.round((totalEngagement / snapshot.recentViews) * 100)
    : 0
  const growth = growthPercent(snapshot.currentWeekViews, snapshot.previousWeekViews)

  let health: AlbumInsightResult['health'] = 'เริ่มต้น'
  if (snapshot.isPublic && snapshot.photoCount > 0) health = 'พร้อมแชร์'
  if (snapshot.recentViews >= 20 || totalEngagement >= 5) health = 'กำลังเติบโต'
  if (snapshot.recentViews >= 50 && interactionRate >= 20) health = 'มีส่วนร่วมสูง'

  const summaryParts = [`“${snapshot.albumTitle}” มีผู้เข้าชม ${number.format(snapshot.recentViews)} ครั้งใน 30 วันที่ผ่านมา`]
  if (totalEngagement > 0) {
    summaryParts.push(`เกิดการมีส่วนร่วม ${number.format(totalEngagement)} ครั้ง`)
  }
  if (growth !== 0) {
    summaryParts.push(`ยอดเข้าชม 7 วันล่าสุด${growth > 0 ? 'เพิ่มขึ้น' : 'ลดลง'} ${number.format(Math.abs(growth))}%`)
  }

  const highlights: string[] = []
  if (snapshot.topPhoto) {
    highlights.push(`ภาพที่โดดเด่นที่สุดคือ ${snapshot.topPhoto.filename} จากคะแนนการเปิดดู หัวใจ และดาวน์โหลด`)
  }
  const peak = hourRange(snapshot.peakHour)
  if (peak) highlights.push(`ช่วงเวลาที่ผู้ชมใช้งานมากที่สุดคือ ${peak}`)
  if (snapshot.faceSearches > 0) highlights.push(`มีการค้นหาใบหน้า ${number.format(snapshot.faceSearches)} ครั้ง`)
  if (snapshot.guestMoments > 0) highlights.push(`แขกร่วมแชร์โมเมนต์แล้ว ${number.format(snapshot.guestMoments)} รายการ`)
  if (!highlights.length) highlights.push('ข้อมูลกำลังสะสม ระบบจะให้คำแนะนำได้แม่นยำขึ้นเมื่อมีผู้ชมเพิ่ม')

  const recommendations: AlbumInsightRecommendation[] = []
  if (!snapshot.hasCover) {
    recommendations.push({
      id: 'add-cover',
      priority: 'high',
      title: 'เพิ่มภาพปกก่อนแชร์',
      detail: 'ภาพปกช่วยให้ลูกค้ารู้จักงานทันทีและทำให้ลิงก์ดูสมบูรณ์ขึ้น',
      actionLabel: 'ตั้งค่าภาพปก',
      actionHref: '#cover',
    })
  }
  if (!snapshot.isPublic) {
    recommendations.push({
      id: 'publish-gallery',
      priority: 'high',
      title: 'แกลเลอรียังไม่เผยแพร่',
      detail: 'ตรวจรูปและสิทธิ์ดาวน์โหลดให้เรียบร้อยก่อนเปิดลิงก์ให้ลูกค้า',
    })
  }
  if (snapshot.photoCount > 80 && snapshot.photoOpens < Math.max(5, snapshot.recentViews)) {
    recommendations.push({
      id: 'tighten-opening-set',
      priority: 'medium',
      title: 'จัดภาพเด่นไว้ช่วงต้นแกลเลอรี',
      detail: 'มีรูปจำนวนมากแต่การเปิดดูรายภาพยังน้อย ลองย้ายภาพเด่น 8–12 ภาพขึ้นก่อนเพื่อพาผู้ชมเข้าสู่เรื่องราวเร็วขึ้น',
      actionLabel: 'จัดเรียงรูป',
      actionHref: 'reorder',
    })
  }
  if (snapshot.recentViews >= 10 && snapshot.downloads === 0) {
    recommendations.push({
      id: 'check-downloads',
      priority: 'medium',
      title: 'ตรวจการตั้งค่าดาวน์โหลด',
      detail: 'มีผู้ชมเข้ามาแล้ว แต่ยังไม่พบการดาวน์โหลด อาจส่งข้อความแจ้งลูกค้าหรือตรวจว่าสิทธิ์ดาวน์โหลดเปิดอยู่',
      actionLabel: 'ตรวจการตั้งค่า',
      actionHref: 'settings',
    })
  }
  if (snapshot.recentViews === 0 && snapshot.isPublic) {
    recommendations.push({
      id: 'share-again',
      priority: 'medium',
      title: 'ส่งลิงก์ให้ลูกค้าอีกครั้ง',
      detail: 'ยังไม่มียอดเข้าชมใน 30 วัน ลองส่งลิงก์พร้อมข้อความสั้นที่บอกว่ารูปพร้อมดูและดาวน์โหลดแล้ว',
    })
  }
  if (snapshot.hearts > 0 && snapshot.downloads === 0) {
    recommendations.push({
      id: 'use-client-picks',
      priority: 'low',
      title: 'ใช้ภาพที่ลูกค้ากดหัวใจเป็นชุดคัดเลือก',
      detail: 'ภาพที่ถูกใจสะท้อนรสนิยมของลูกค้าได้ดี สามารถใช้เป็นจุดเริ่มต้นของชุดส่งพิมพ์หรือโพสต์โปรโมตได้',
    })
  }
  if (!recommendations.length) {
    recommendations.push({
      id: 'keep-sharing',
      priority: 'low',
      title: 'แกลเลอรีอยู่ในสถานะดี',
      detail: 'ติดตามภาพยอดนิยมและช่วงเวลาที่ผู้ชมเข้ามา เพื่อเลือกเวลาส่งข่าวหรือเตือนดาวน์โหลดครั้งถัดไป',
    })
  }

  const notificationDraft = snapshot.isPublic && snapshot.photoCount > 0
    ? {
        title: `รูปจาก ${snapshot.albumTitle} พร้อมแล้ว`,
        summary: `เปิดชม กดหัวใจ และดาวน์โหลดภาพโปรดจากแกลเลอรี ${snapshot.albumTitle} ได้แล้ววันนี้`,
      }
    : null

  return {
    version: 'ciiya-insights-v1',
    generatedAt: new Date().toISOString(),
    summary: `${summaryParts.join(' และ ')}.`,
    health,
    highlights,
    recommendations: recommendations.slice(0, 3),
    notificationDraft,
    privacy: 'วิเคราะห์จากสถิติและเมทาดาทาภายใน Ciiya เท่านั้น ไม่มีการส่งรูปหรือข้อมูลใบหน้าออกนอกระบบ',
    snapshot,
  }
}
