import type { Metadata } from "next"
import localFont from "next/font/local"
import { Manrope } from "next/font/google"
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

export const metadata: Metadata = {
  title: "Ciiya — Keep and share every important moment",
  description: "Store, upload, and share photo galleries beautifully and securely",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={`${manrope.variable} ${fcMittraphap.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}

        {/* Background worker */}
        <AutoWorker />
      </body>
    </html>
  )
}
