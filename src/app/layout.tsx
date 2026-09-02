import type { Metadata, Viewport } from "next"
import localFont from "next/font/local"
import { Manrope } from "next/font/google"
import { getLocale } from "@/lib/i18n-server"
import { I18nProvider } from "@/components/i18n-provider"
import { getSiteUrl } from "@/lib/site-url"
import "./globals.css"
import AutoWorker from '@/components/auto-worker'
import '@/lib/env'

/*
 * Manrope is the primary face for the whole app. It carries Latin only, so it
 * is paired with FC Mittraphap below: the browser reaches for Manrope first
 * and falls through to FC Mittraphap for any Thai glyph, keeping one look
 * across both scripts even within a single sentence.
 */
const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
})

const fcMittraphap = localFont({
  variable: "--font-fc-mittraphap",
  src: [
    { path: "./fonts/FCMittraphap-Light.ttf", weight: "300", style: "normal" },
    { path: "./fonts/FCMittraphap-Regular.ttf", weight: "400", style: "normal" },
    { path: "./fonts/FCMittraphap-Italic.ttf", weight: "400", style: "italic" },
    { path: "./fonts/FCMittraphap-Medium.ttf", weight: "500", style: "normal" },
    { path: "./fonts/FCMittraphap-MediumItalic.ttf", weight: "500", style: "italic" },
    { path: "./fonts/FCMittraphap-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "./fonts/FCMittraphap-Bold.ttf", weight: "700", style: "normal" },
    { path: "./fonts/FCMittraphap-Black.ttf", weight: "900", style: "normal" },
  ],
  display: "swap",
  preload: false,
  fallback: ["Arial", "sans-serif"],
})

const siteUrl = getSiteUrl()

const tagline = "เก็บและแชร์ทุกช่วงเวลาสำคัญ"
const summary =
  "อัปโหลด จัดเก็บ และแชร์แกลเลอรีภาพถ่ายอย่างสวยงามและปลอดภัย — ค้นหาภาพตัวเองด้วยใบหน้า พร้อมหน้าพอร์ตโฟลิโอสำหรับช่างภาพ"

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `Ciiya — ${tagline}`,
    template: "%s · Ciiya",
  },
  description: summary,
  applicationName: "Ciiya",
  keywords: [
    "Ciiya",
    "แกลเลอรีภาพถ่าย",
    "แชร์รูปงานอีเวนต์",
    "ค้นหารูปด้วยใบหน้า",
    "พอร์ตโฟลิโอช่างภาพ",
    "photo gallery",
    "face search",
    "event photography",
    "photographer portfolio",
  ],
  authors: [{ name: "Ciiya" }],
  creator: "Ciiya",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Ciiya",
    title: `Ciiya — ${tagline}`,
    description: summary,
    url: siteUrl,
    locale: "th_TH",
  },
  twitter: {
    card: "summary_large_image",
    title: `Ciiya — ${tagline}`,
    description: summary,
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/icon.svg",
  },
  robots: { index: true, follow: true },
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f6f1" },
    { media: "(prefers-color-scheme: dark)", color: "#171717" },
  ],
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const locale = await getLocale()

  return (
    <html
      lang={locale}
      className={`${manrope.variable} ${fcMittraphap.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <I18nProvider locale={locale}>{children}</I18nProvider>

        {/* Background worker */}
        <AutoWorker />
      </body>
    </html>
  )
}
