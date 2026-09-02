import { ImageResponse } from 'next/og'

export const runtime = 'nodejs'

export const alt = 'Ciiya — keep and share every important moment'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// The brand mark (gold aperture on ink), inlined as a data URI so the OG
// renderer needs no network fetch. Kept in sync with /app/icon.svg.
const mark = `data:image/svg+xml,${encodeURIComponent(
  `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg"><circle cx="256" cy="256" r="138" fill="none" stroke="#c7a86b" stroke-width="46" stroke-linecap="round" stroke-dasharray="650 217" transform="rotate(45 256 256)"/><circle cx="256" cy="256" r="34" fill="#c7a86b"/></svg>`
)}`

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '96px',
          background: '#171717',
          backgroundImage:
            'radial-gradient(circle at 82% 14%, rgba(199,168,107,0.22), transparent 55%)',
          fontFamily: 'sans-serif',
        }}
      >
        <img src={mark} width={128} height={128} alt="" />
        <div
          style={{
            display: 'flex',
            fontSize: 104,
            fontWeight: 700,
            color: '#f8f6f1',
            marginTop: 36,
            letterSpacing: -3,
          }}
        >
          Ciiya
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 40,
            color: '#c7a86b',
            marginTop: 6,
          }}
        >
          Keep &amp; share every important moment
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 26,
            color: '#a8a29a',
            marginTop: 44,
            letterSpacing: 1,
          }}
        >
          Photo galleries · Face search · Photographer portfolios
        </div>
      </div>
    ),
    { ...size }
  )
}
