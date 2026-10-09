'use client'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type HeroMedia = 'mower' | 'garden' | 'sleep'

// What a typical gas crew burns on one residential visit (push mower +
// 2-stroke trimmer + blower ≈ 0.35 gal). EPA: 8.89 kg CO₂ per gallon of gas.
// CARB: 1 hr of a commercial gas blower ≈ smog of driving a car ~1,100 mi;
// we assume ~10 min of blowing per visit.
const GAL_PER_JOB       = 0.35
const LBS_CO2_PER_GAL   = 19.6
const SMOG_MILES_PER_JOB = 180

// One household's season ≈ 30 mows
const MOWS_PER_SEASON = 30

const MEDIA = {
  mower: {
    src: '/videos/mower-broll.mp4',
    poster: '/videos/mower-broll.jpg',
    eyebrow: 'The actual mower',
    title: 'Battery power. No exhaust.',
  },
  garden: {
    src: '/videos/garden-beds.mp4',
    poster: '/videos/garden-beds.jpg',
    eyebrow: 'Bed cleanups & shrub trimming',
    title: 'More than mowing.',
  },
  sleep: {
    src: '/videos/530am-mow.mp4',
    poster: '/videos/530am-mow.jpg',
    eyebrow: '5:30 AM · Austin, TX',
    title: 'They slept through the whole thing.',
  },
} as const

function useCountUp(target: number, run: boolean, ms = 1600) {
  const [val, setVal] = useState(0)
  useEffect(() => {
    if (!run) return
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min((now - start) / ms, 1)
      setVal(target * (1 - Math.pow(1 - t, 3)))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, run, ms])
  return val
}

function EmissionsCounter({ onClose }: { onClose: () => void }) {
  const n = MOWS_PER_SEASON
  const gal  = useCountUp(n * GAL_PER_JOB, true)
  const co2  = useCountUp(n * GAL_PER_JOB * LBS_CO2_PER_GAL, true)
  const smog = useCountUp(n * SMOG_MILES_PER_JOB, true)
  const fmt = (v: number, d = 0) => v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d })

  return (
    <div className="hm-emissions">
      <div className="hm-emissions-head">
        <strong>Your yard, one season</strong> with a typical gas crew:
      </div>
      <div className="hm-emissions-grid">
        <div className="hm-stat">
          <div className="hm-stat-val">{fmt(co2)}<span> lbs</span></div>
          <div className="hm-stat-label">of CO₂ right outside your windows</div>
        </div>
        <div className="hm-stat">
          <div className="hm-stat-val">{fmt(gal, 1)}<span> gal</span></div>
          <div className="hm-stat-label">of gasoline burned</div>
        </div>
        <div className="hm-stat">
          <div className="hm-stat-val">{fmt(smog)}<span> mi</span></div>
          <div className="hm-stat-label">of car-equivalent smog</div>
        </div>
      </div>
      <div className="hm-ours">
        <div className="hm-ours-label">Switch to QuietGreen</div>
        <div className="hm-ours-row">
          <div className="hm-ours-stat"><span className="hm-ours-val">0</span><span className="hm-ours-unit">lbs CO₂</span></div>
          <div className="hm-ours-stat"><span className="hm-ours-val">0</span><span className="hm-ours-unit">gal gas</span></div>
          <div className="hm-ours-stat"><span className="hm-ours-val">0</span><span className="hm-ours-unit">mi smog</span></div>
        </div>
        <div className="hm-ours-tag">Same great lawn. Nothing in the air but fresh-cut grass.</div>
      </div>
      <a href="#map-quote" className="hm-cta" onClick={onClose}>
        Make the switch: get my price
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
      </a>
      <div className="hm-footnote">Based on ~30 mows a season. Estimates from EPA &amp; California Air Resources Board figures for gas mowers, trimmers and blowers.</div>
    </div>
  )
}

export default function HeroMediaModal({
  media, onClose,
}: {
  media: HeroMedia | null
  onClose: () => void
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!media) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [media, onClose])

  if (!media) return null
  const m = MEDIA[media]
  const failed = failedSrc === m.src

  // Portal to <body> so the hero's stacking context can't put later page
  // sections (or the fixed nav) on top of the modal
  return createPortal(
    <div className="hm-backdrop" onClick={onClose}>
      <div
        className={`hm-dialog hm-${media}`}
        role="dialog"
        aria-modal="true"
        aria-label={m.title}
        onClick={e => e.stopPropagation()}
      >
        <button ref={closeRef} className="hm-close" onClick={onClose} aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>

        <div className="hm-video-wrap">
          {failed ? (
            <div className="hm-video-missing">Footage coming soon.</div>
          ) : (
            <video
              key={m.src}
              className="hm-video"
              src={m.src}
              poster={m.poster}
              autoPlay
              playsInline
              controls
              loop
              onError={() => setFailedSrc(m.src)}
            />
          )}
        </div>

        <div className="hm-body">
          <div className="hm-eyebrow">{m.eyebrow}</div>
          <h3 className="hm-title">{m.title}</h3>
          {media === 'mower' ? (
            <EmissionsCounter onClose={onClose} />
          ) : media === 'garden' ? (
            <p className="hm-copy">
              Overgrown beds cut back by hand, shrubs shaped, and every clipping
              hauled off in paper yard bags. Same battery-powered crew, so no
              gas trimmer screaming next to your windows.
            </p>
          ) : (
            <p className="hm-copy">
              Real footage, mowing in the dark before sunrise. Our battery equipment
              runs around 60 dB, about as loud as a normal conversation, so we can
              start early and beat the Texas heat without waking the house.
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
