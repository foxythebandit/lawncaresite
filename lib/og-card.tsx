import { ImageResponse } from 'next/og'

export const OG_SIZE = { width: 1200, height: 630 }

// Shared social-share card: brand mark, headline, and a one-line subhead.
export function ogCard(eyebrow: string, headline: string, subhead: string) {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px 80px',
          background: '#1a3a2a',
          color: '#fff',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 36 }}>
          <div style={{ width: 22, height: 22, borderRadius: 11, background: '#52b788' }} />
          QuietGreen
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ fontSize: 24, letterSpacing: 3, textTransform: 'uppercase', color: '#52b788' }}>{eyebrow}</div>
          <div style={{ fontSize: 68, lineHeight: 1.1, maxWidth: 980 }}>{headline}</div>
          <div style={{ fontSize: 30, color: 'rgba(255,255,255,.7)' }}>{subhead}</div>
        </div>
      </div>
    ),
    OG_SIZE,
  )
}
