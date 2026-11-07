import type { Metadata, Viewport } from "next"
import localFont from "next/font/local"
import { Manrope } from "next/font/google"
import { getLocale } from "@/lib/i18n-server"
import { I18nProvider } from "@/components/i18n-provider"
import { getSiteUrl } from "@/lib/site-url"
import "./globals.css"
import AutoWorker from '@/components/auto-worker'
import '@/lib/env'

// B2B handles Thai and digits only; existing Latin and specialist fonts stay in place.
const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
})

const b2bHybridText = localFont({
  variable: "--font-b2b-hybrid-text",
  src: [
    { path: "./fonts/b2b-hybrid/B2BHybridText-Thin.woff2", weight: "100", style: "normal" },
    { path: "./fonts/b2b-hybrid/B2BHybridText-ExtraLight.woff2", weight: "200", style: "normal" },
    { path: "./fonts/b2b-hybrid/B2BHybridText-Light.woff2", weight: "300", style: "normal" },
    { path: "./fonts/b2b-hybrid/B2BHybridText-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/b2b-hybrid/B2BHybridText-Medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/b2b-hybrid/B2BHybridText-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "./fonts/b2b-hybrid/B2BHybridText-Bold.woff2", weight: "700", style: "normal" },
    { path: "./fonts/b2b-hybrid/B2BHybridText-ExtraBold.woff2", weight: "800", style: "normal" },
    { path: "./fonts/b2b-hybrid/B2BHybridText-Black.woff2", weight: "900", style: "normal" },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0030-0039, U+0E00-0E7F" }],
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
      className={`${manrope.variable} ${b2bHybridText.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <I18nProvider locale={locale}>{children}</I18nProvider>

        {/* Background worker */}
        <AutoWorker />
      </body>
    </html>
  )
}
