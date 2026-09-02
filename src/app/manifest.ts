import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Ciiya',
    short_name: 'Ciiya',
    description: 'เก็บและแชร์ทุกช่วงเวลาสำคัญ — แกลเลอรีภาพถ่าย ค้นหาด้วยใบหน้า และพอร์ตโฟลิโอช่างภาพ',
    start_url: '/',
    display: 'standalone',
    background_color: '#f8f6f1',
    theme_color: '#171717',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/favicon.ico', sizes: '48x48', type: 'image/x-icon' },
    ],
  }
}
