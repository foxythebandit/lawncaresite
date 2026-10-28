'use client'

import 'maplibre-gl/dist/maplibre-gl.css'
import './map-waitlist.css'
import './property-location.css'
import { useEffect, useRef, useState, useCallback } from 'react'
import { DayPicker } from 'react-day-picker'
import 'react-day-picker/style.css'
import { submitBooking } from '@/app/actions/submit-booking'
import { getParcel }    from '@/app/actions/get-parcel'
import TraceDemo        from '@/components/TraceDemo'
import { submitLead }   from '@/app/actions/submit-lead'
import { updateWebsitePrice } from '@/app/actions/update-website-price'
import { submitWaitlist } from '@/app/actions/submit-waitlist'
import { getAttribution } from '@/lib/attribution'
import { trackQuoteAddressFound, trackQuoteLawnTraced, trackQuoteShown, trackAddonInterest, trackBookingRequested } from '@/lib/gtag'
import { trackWebsiteLead } from '@/lib/meta-events'
import { QUOTE_CONSENT_TEXT as LEAD_CONSENT_TEXT } from '@/lib/quote-consent'
import { submissionId } from '@/lib/submission-id'
import { OFFICE_LAT, OFFICE_LNG, photonSearch, geocodeAddress, cachedGeocode, type GeoResult } from '@/lib/address-search'
import { isPropertyConfirmed, parseManualPropertyLocation, type PropertyConfirmation } from '@/lib/property-location'
import { ESRI_IMAGERY, MAPBOX_TOKEN } from '@/lib/map-imagery'
import { saveLeadQuote } from '@/app/admin/leads/quote-actions'
import { type StaffQuote, type QuoteDraft } from '@/lib/quote-draft'
import QuotePriceEditor, { type ManualPriceLine } from '@/app/admin/leads/QuotePriceEditor'
import ManualQuoteForm from './ManualQuoteForm'

/* ── Types ────────────────────────────────────────────── */
type AppStep = 'idle' | 'searching' | 'confirming' | 'drawing' | 'done' | 'editing'
type Frequency = 'onetime' | 'monthly' | 'biweekly' | 'weekly'

interface Section {
  id: string
  name: string
  sqFt: number
  coords: [number, number][] | null
}

/* ── Constants ────────────────────────────────────────── */
const FREQ: Record<Frequency, { label: string; sub: string; discount: number }> = {
  onetime:  { label: 'One-time', sub: 'Single visit', discount: 0  },
  monthly:  { label: 'Monthly',   sub: '1× / month',  discount: 0  },
  biweekly: { label: 'Bi-weekly', sub: '2× / month',  discount: 10 },
  weekly:   { label: 'Weekly',    sub: '4× / month',  discount: 15 },
}

const FIRST_VISIT_DISCOUNT_PCT = 30

const SECT_COLORS = ['#52b788', '#74c9a0', '#2d9e6b', '#38a878', '#95dbb8']

const MOWER_CURSOR = 'crosshair'

const LAST_MOW_OPTS = [
  { key: 'thisweek', label: 'This week',  sub: '0–7 days'  },
  { key: 'biweekly', label: '2–3 weeks',  sub: '~2–3 wks'  },
  { key: 'month',    label: '~1 month',   sub: '3–5 weeks' },
  { key: 'overdue',  label: '2+ months',  sub: '6+ weeks'  },
]
const LAST_MOW_WEEKS: Record<string, number> = {
  thisweek: 0.5, biweekly: 2.5, month: 4, overdue: 9,
}

/* ── Constants ────────────────────────────────────────── */
// Addresses farther than this get an "outside our area" message instead of a quote
const SERVICE_RADIUS_MILES = 30



/* ── Helpers ──────────────────────────────────────────── */
function uid() { return Math.random().toString(36).slice(2, 8) }

/* Mowing: flat rate for small lawns, then a per-sq-ft rate that tapers as
   lawns get bigger. Each tier starts where the last one ended, so there
   are no price jumps at the breakpoints. */
const MOW_BASE_PRICE = 75
const MOW_BASE_SQFT  = 2250
const MOW_TIERS: { upTo: number; rate: number }[] = [
  { upTo: 5000,     rate: 0.0198 },
  { upTo: 12000,    rate: 0.0143 },
  { upTo: Infinity, rate: 0.0099 },
]

function calcPrice(sqFt: number): number {
  let price = MOW_BASE_PRICE, from = MOW_BASE_SQFT
  for (const { upTo, rate } of MOW_TIERS) {
    if (sqFt <= from) break
    price += (Math.min(sqFt, upTo) - from) * rate
    from = upTo
  }
  return Math.round(price)
}

/* ── Sharper Esri imagery ─────────────────────────────── */
// Esri has zoom 20–21 photos across most of the service area, but where it
// doesn't it serves a grey "Map data not yet available" tile instead of a 404.
// The `esri-hd://` protocol loads the real tile when there is one and, for the
// placeholder, crops + enlarges the nearest real ancestor tile instead.
const ESRI_ALWAYS_AVAILABLE_Z = 19
// A tile Esri has no imagery for (mid-Pacific) — byte-identical to every placeholder
const ESRI_PLACEHOLDER_URL = `${ESRI_IMAGERY}/21/1048575/131072`
let esriPlaceholder: Promise<Uint8Array | null> | null = null

function isPlaceholder(bytes: Uint8Array, ref: Uint8Array | null) {
  if (!ref || bytes.length !== ref.length) return false
  for (let i = 0; i < bytes.length; i++) if (bytes[i] !== ref[i]) return false
  return true
}

async function loadEsriTile(z: number, y: number, x: number, signal: AbortSignal): Promise<ArrayBuffer> {
  esriPlaceholder ??= fetch(ESRI_PLACEHOLDER_URL).then(r => r.arrayBuffer()).then(b => new Uint8Array(b)).catch(() => null)
  const buf = await (await fetch(`${ESRI_IMAGERY}/${z}/${y}/${x}`, { signal })).arrayBuffer()
  if (z <= ESRI_ALWAYS_AVAILABLE_Z || !isPlaceholder(new Uint8Array(buf), await esriPlaceholder)) return buf

  // Walk up to the nearest zoom that has a real photo, then crop out this tile's quarter (or sixteenth)
  for (let k = 1; z - k >= ESRI_ALWAYS_AVAILABLE_Z; k++) {
    const pz = z - k, px = x >> k, py = y >> k
    const pbuf = await (await fetch(`${ESRI_IMAGERY}/${pz}/${py}/${px}`, { signal })).arrayBuffer()
    if (pz > ESRI_ALWAYS_AVAILABLE_Z && isPlaceholder(new Uint8Array(pbuf), await esriPlaceholder)) continue
    const img = await createImageBitmap(new Blob([pbuf]))
    const part = 256 >> k
    const canvas = new OffscreenCanvas(256, 256)
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, (x - (px << k)) * part, (y - (py << k)) * part, part, part, 0, 0, 256, 256)
    return (await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 })).arrayBuffer()
  }
  return buf
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function calcDistanceFee(miles: number): { fee: number; label: string } {
  if (miles <= 10) return { fee: 0,  label: '' }
  if (miles <= 15) return { fee: 10, label: `Travel (${miles.toFixed(1)} mi)` }
  if (miles <= 20) return { fee: 18, label: `Travel (${miles.toFixed(1)} mi)` }
  return                  { fee: 28, label: `Travel (${miles.toFixed(1)} mi)` }
}

function getSeasonInfo(month: number) {
  if (month >= 4 && month <= 7)
    return { name: 'Peak season',     multiplier: 1.0, note: 'Grass grows up to 1″ per week right now', color: '#52b788' }
  if (month === 2 || month === 3 || month === 8 || month === 9)
    return { name: 'Shoulder season', multiplier: 0.5, note: 'Moderate growth this time of year',       color: '#95dbb8' }
  return   { name: 'Dormant season',  multiplier: 0.1, note: 'Minimal growth — no cleanup fees apply',  color: 'rgba(255,255,255,.35)' }
}

function calcFertPrice(sqFt: number): number {
  return sqFt <= 2500 ? 70 : Math.round(70 + (sqFt - 2500) * 0.015)
}

const MULCH_RATE_PER_CU_YD   = 100
const MULCH_MINIMUM          = 150
const MULCH_DEFAULT_DEPTH_IN = 3

function calcMulchCuYd(sqFt: number, depthIn: number): number {
  return sqFt * depthIn / 324
}

function calcMulchPrice(sqFt: number, depthIn: number): number {
  return Math.max(MULCH_MINIMUM, Math.round(calcMulchCuYd(sqFt, depthIn) * MULCH_RATE_PER_CU_YD))
}

const FERT_DISCLAIMER =
  "Base price covers a standard fertilizer treatment. Final price may be higher depending on your lawn's needs, such as weed control, organic products, soil amendments, or treating disease and pests. We'll confirm before any extra work."

type AddonKey = 'fertilization' | 'mulch' | 'leafCleanup' | 'maintenance' | 'yardClearout'
type DrawableAddonKey = Exclude<AddonKey, 'maintenance' | 'leafCleanup'>

const ADDON_META: Record<AddonKey, { label: string; blurb: string; priceHint: string; color: string }> = {
  fertilization: { label: 'Fertilization',  blurb: "A feeding and weed-control schedule matched to Central Texas grasses like St. Augustine, Bermuda and Zoysia.", priceHint: 'Starting around $70/treatment.',                                        color: '#ffd166' },
  mulch:         { label: 'Mulch',          blurb: 'Fresh mulch for your beds, with edging and cleanup.',                                                         priceHint: 'Starting around $150 installed (3" depth).',                           color: '#c08552' },
  leafCleanup:   { label: 'Leaf Cleanup',   blurb: 'Leaves cleared from your lawn, beds and walkways with quiet battery blowers — no gas fumes.',                 priceHint: 'From $99 · most yards $150–$250 · haul-away +$50.',                     color: '#e9a23b' },
  maintenance:   { label: 'Bed Maintenance', blurb: 'Weeding, bed care and touch-ups between mows — so your beds stay as sharp as the lawn.',                     priceHint: 'Visits from $75.',                                                      color: '#95dbb8' },
  yardClearout:  { label: 'Yard Clearout',  blurb: "Clearing overgrown beds, bushes, vines, cactus and brush — we'll bring a jungle back under control.",          priceHint: 'Starting around $75 — e.g. ~$125 for a 200 sq ft heavy clearout.',      color: '#e07a5f' },
}

/* Leaf cleanup: flat tiers by traced lawn size, so customers see a fixed
   price instead of an hourly rate. Starting rates — revisit once real jobs
   show how long each tier takes. */
const LEAF_HAUL_AWAY_FEE = 50
function calcLeafPrice(sqFt: number, haulAway: boolean): number {
  const base = sqFt <= 2000 ? 99 : sqFt <= 5000 ? 175 : sqFt <= 10000 ? 300 : 450
  return base + (haulAway ? LEAF_HAUL_AWAY_FEE : 0)
}

/* Yard clearout: $/sq ft by overgrowth level. "Heavy" is anchored to a real
   job ($125 for ~200 sq ft of heavy bed overgrowth); light/moderate are
   drafted proportionally and worth revisiting once a few more jobs land. */
type ClearoutSeverity = 'light' | 'moderate' | 'heavy'
const CLEAROUT_RATES: Record<ClearoutSeverity, number> = { light: 0.30, moderate: 0.45, heavy: 0.625 }
const CLEAROUT_MINIMUM = 75
const CLEAROUT_LEVELS: { key: ClearoutSeverity; label: string; sub: string }[] = [
  { key: 'light',    label: 'Light',    sub: 'A little overgrown' },
  { key: 'moderate', label: 'Moderate', sub: 'Needs real work' },
  { key: 'heavy',    label: 'Heavy',    sub: 'Jungle mode' },
]

function calcClearoutPrice(sqFt: number, severity: ClearoutSeverity): number {
  return Math.max(CLEAROUT_MINIMUM, Math.round(sqFt * CLEAROUT_RATES[severity]))
}

/* Hazards bump the clearout price — crew needs gear/time either way. */
const CLEAROUT_HAZARD_SURCHARGE_PCT = 20
const CLEAROUT_HAZARDS: { key: string; label: string }[] = [
  { key: 'poison_ivy', label: 'Poison ivy' },
  { key: 'thorns',     label: 'Thorns / cactus' },
  { key: 'debris',     label: 'Buried debris or rocks' },
]

function calcOvergrowthFee(weeks: number, multiplier: number): { fee: number; label: string } {
  const score = weeks * multiplier
  if (score >= 6)   return { fee: 45, label: 'Heavy first-cut cleanup' }
  if (score >= 3)   return { fee: 25, label: 'First-cut cleanup' }
  if (score >= 1.5) return { fee: 15, label: 'Light cleanup fee' }
  return                   { fee: 0,  label: '' }
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/** Flat-earth shoelace area in sq ft */
// Carry the visitor to the next thing they need to do. Deferred a frame so it
// runs after the state change that reveals the target has rendered.
function scrollToNext(ref: React.RefObject<HTMLElement | null>, block: ScrollLogicalPosition = 'start') {
  requestAnimationFrame(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ref.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block })
  })
}

function polygonSqFt(coords: [number, number][]): number {
  if (coords.length < 3) return 0
  const cosLat = Math.cos(coords[0][1] * Math.PI / 180)
  const pts = coords.map(([lng, lat]) => [lng * cosLat * 111319.9, lat * 111319.9])
  let area = 0
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    area += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1]
  }
  return Math.round(Math.abs(area) / 2 * 10.7639)
}

function sectionsGeoJSON(sections: Section[]): object {
  return {
    type: 'FeatureCollection',
    features: sections
      .filter(s => s.coords && s.coords.length >= 3)
      .map((s, i) => ({
        type: 'Feature',
        properties: { color: SECT_COLORS[i % SECT_COLORS.length] },
        geometry: { type: 'Polygon', coordinates: [s.coords!] },
      })),
  }
}

/* ── Icons ────────────────────────────────────────────── */
const CheckIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

/* ── Component ────────────────────────────────────────── */
export default function MapQuoteBuilder({ staffQuote }: { staffQuote?: StaffQuote }) {
  const staffMode = !!staffQuote
  const draft = staffQuote?.draft
  const contactAddressAtReview = useRef(draft?.contactAddressAtReview ?? staffQuote?.address ?? null)
  const requestedServices = (staffQuote?.services ?? []).map(s => s.toLowerCase().replace(/[^a-z]/g, ''))
  const requestedFrequency = staffQuote?.frequency?.toLowerCase().replace(/[^a-z]/g, '') as Frequency | undefined
  const [leadToken, setLeadToken] = useState<string | undefined>(undefined)
  // The price on screen and the traced shapes, read by the unlock submit (PLAN.md 3.3, S10, S12).
  // Staff mode: the lead page opens at the top; the builder only scrolls itself after staff use it.
  const staffUsed = useRef(false)
  const shownQuote = useRef<{ price: { price_per_visit: number; first_visit_price: number; frequency: Frequency }; tracing: Omit<Section, 'id'>[] } | null>(null)
  const [saveMessage, setSaveMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [overridePrice, setOverridePrice] = useState<number | null>(() => draft?.overridePrice ?? null)
  const [staffNotes, setStaffNotes] = useState(() => draft?.notes ?? '')
  const [includeMowing, setIncludeMowing] = useState(() => draft?.includeMowing ?? (!!draft?.sections.length || requestedServices.some(service => service.includes('mow') || service.includes('lawn'))))
  const [showStaffMap, setShowStaffMap] = useState(() => !staffQuote || !!draft?.sections.length || !!(draft?.includeMowing ?? requestedServices.some(service => service.includes('mow') || service.includes('lawn'))))
  const [manualLines, setManualLines] = useState<ManualPriceLine[]>(() => draft?.manualLines ?? (staffQuote?.services ?? [])
    .filter(service => !/mow|lawn/i.test(service)).map((service, index) => ({ id: `requested-${index}`, service, amountCents: 0 })))
  const [discountCents, setDiscountCents] = useState(() => draft?.discountCents ?? 0)
  const [mapReady, setMapReady] = useState(false)
  const restored = useRef(false)

  useEffect(() => {
    if (!showStaffMap) return
    const frame = requestAnimationFrame(() => mapRef.current?.resize())
    return () => cancelAnimationFrame(frame)
  }, [showStaffMap])

  const mapDivRef        = useRef<HTMLDivElement>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement>(null)
  const mapRef           = useRef<any>(null)
  const rafRef           = useRef<number>(0)
  const liveRef          = useRef<number>(0)
  const cursorLngLatRef  = useRef<[number, number] | null>(null)

  const drawRef = useRef<{
    points:    [number, number][]
    clickFn:   ((e: any) => void) | null
    moveFn:    ((e: any) => void) | null
    mapMoveFn: (() => void) | null
  }>({ points: [], clickFn: null, moveFn: null, mapMoveFn: null })

  const suggestionVersion = useRef(0)
  const searchVersion = useRef(0)
  const searchAbortRef = useRef<AbortController | null>(null)
  const addressInputRef = useRef<HTMLInputElement>(null)
  const suggestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suggestAbortRef = useRef<AbortController | null>(null)
  const addressWrapRef  = useRef<HTMLDivElement>(null)
  const teaserWrapRef   = useRef<HTMLDivElement>(null)
  const leadGateRef     = useRef<HTMLDivElement>(null)
  const leadPhoneRef    = useRef<HTMLInputElement>(null)
  const priceTitleRef   = useRef<HTMLDivElement>(null)
  const addonsRef       = useRef<HTMLDivElement>(null)

  const [step,        setStep]        = useState<AppStep>(() => draft?.sections.length ? 'done' : 'idle')
  const [address,     setAddress]     = useState(() => draft?.address ?? staffQuote?.lookupAddress ?? staffQuote?.address ?? '')
  const [error,       setError]       = useState('')
  const [outsideArea, setOutsideArea] = useState(false)
  const [waitlistName, setWaitlistName] = useState('')
  const [waitlistPhone, setWaitlistPhone] = useState('')
  const [waitlistEmail, setWaitlistEmail] = useState('')
  const [waitlistState, setWaitlistState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [waitlistError, setWaitlistError] = useState('')
  const [suggestions, setSuggestions] = useState<GeoResult[]>([])
  // The suggestion the visitor picked — reused on search so we don't geocode it again
  const pickedRef = useRef<GeoResult | null>(null)
  const [activeSug,   setActiveSug]   = useState(-1)
  const [sections, setSections] = useState<Section[]>(() => draft?.sections ?? (staffQuote?.sq_ft ? [{ id: 'initial', name: 'Lawn', sqFt: staffQuote.sq_ft, coords: null }] : []))
  const sectionsCountRef = useRef(sections.length)
  useEffect(() => { sectionsCountRef.current = sections.length }, [sections])
  const [lawnSqFt, setLawnSqFt] = useState<number | null>(null)
  const [animSqFt, setAnimSqFt] = useState(0)
  const [liveSqFt, setLiveSqFt] = useState(0)
  const [freq,     setFreq]     = useState<Frequency>(() => draft?.freq ?? (requestedFrequency && requestedFrequency in FREQ ? requestedFrequency : 'biweekly'))
  const [lastMow,  setLastMow]  = useState(() => draft?.lastMow ?? 'thisweek')
  const [isDrawing,setIsDrawing]= useState(false)
  const [drawCount,setDrawCount]= useState(0)
  const [ptCount,  setPtCount]  = useState(0)

  const [showManualSqFt,  setShowManualSqFt]  = useState(false)
  const [manualSqFtInput, setManualSqFtInput] = useState('')

  const [openAddon,       setOpenAddon]       = useState<AddonKey | null>(null)
  const [addonDrawTarget, setAddonDrawTarget] = useState<DrawableAddonKey | null>(null)
  const [teaserTip,       setTeaserTip]       = useState<AddonKey | null>(null)
  // Other services stay tucked behind one link so the quote header stays calm
  const [servicesOpen,    setServicesOpen]    = useState(() => requestedServices.length > 1)

  const [fertAreaChoice, setFertAreaChoice] = useState<'same' | 'custom' | null>(() => draft?.fertAreaChoice ?? null)
  const [fertCustomSqFt, setFertCustomSqFt] = useState<number | null>(() => draft?.fertCustomSqFt ?? null)
  const [fertIncluded,   setFertIncluded]   = useState(() => draft?.fertIncluded ?? requestedServices.includes('fertilization'))

  const [mulchAreaChoice, setMulchAreaChoice] = useState<'same' | 'custom' | null>(() => draft?.mulchAreaChoice ?? null)
  const [mulchCustomSqFt, setMulchCustomSqFt] = useState<number | null>(() => draft?.mulchCustomSqFt ?? null)
  const [mulchDepthIn,    setMulchDepthIn]    = useState(() => draft?.mulchDepthIn ?? MULCH_DEFAULT_DEPTH_IN)
  const [mulchIncluded,   setMulchIncluded]   = useState(() => draft?.mulchIncluded ?? requestedServices.includes('mulch'))

  const [leafIncluded, setLeafIncluded] = useState(() => draft?.leafIncluded ?? requestedServices.includes('leafcleanup'))
  const [leafHaulAway, setLeafHaulAway] = useState(() => draft?.leafHaulAway ?? false)

  const [maintenanceInterested, setMaintenanceInterested] = useState(() => draft?.maintenanceInterested ?? requestedServices.includes('maintenance'))

  const [yardAreaChoice, setYardAreaChoice] = useState<'same' | 'custom' | null>(() => draft?.yardAreaChoice ?? null)
  const [yardCustomSqFt, setYardCustomSqFt] = useState<number | null>(() => draft?.yardCustomSqFt ?? null)
  const [yardSeverity,   setYardSeverity]   = useState<ClearoutSeverity>(() => draft?.yardSeverity ?? 'moderate')
  const [yardHazards,    setYardHazards]    = useState<string[]>(() => draft?.yardHazards ?? [])
  const [yardIncluded,   setYardIncluded]   = useState(() => draft?.yardIncluded ?? requestedServices.includes('yardclearout'))

  const [leadUnlocked, setLeadUnlocked] = useState(() => !!staffQuote)
  const [leadPhone,    setLeadPhone]    = useState('')
  const [leadConsent,  setLeadConsent]  = useState(false)
  const [leadStatus,   setLeadStatus]   = useState<'idle' | 'submitting'>('idle')
  const [leadError,    setLeadError]    = useState('')

  const [jobLatLng,     setJobLatLng]     = useState<{ lat: number; lng: number } | null>(() => draft?.jobLatLng ?? null)
  const [propertyConfirmation, setPropertyConfirmation] = useState<PropertyConfirmation | null>(draft?.propertyConfirmation ?? null)
  const [manualLocation, setManualLocation] = useState('')
  const [candidateLabel, setCandidateLabel] = useState('')
  const [showBooking,   setShowBooking]   = useState(false)
  const [bookingName,   setBookingName]   = useState('')
  const [bookingPhone,  setBookingPhone]  = useState('')
  const [bookingEmail,  setBookingEmail]  = useState('')
  const [bookingDate,   setBookingDate]   = useState<Date | undefined>(undefined)
  const [bookingTimeWindow, setBookingTimeWindow] = useState('')
  const [bookingNotes,  setBookingNotes]  = useState('')
  const [bookingStatus,    setBookingStatus]    = useState<'idle' | 'submitting' | 'success'>('idle')
  const [bookingError,     setBookingError]     = useState('')
  const [mapScreenshot,    setMapScreenshot]    = useState('')

  /* ─── Init MapLibre ──────────────────────────────────── */
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return
    let alive = true
    ;(async () => {
      try {
      const ml = (await import('maplibre-gl')).default
      if (!alive || !mapDivRef.current) return
      ml.addProtocol('esri-hd', (params, abortController) => {
        const [z, y, x] = params.url.slice('esri-hd://'.length).split('/').map(Number)
        return loadEsriTile(z, y, x, abortController.signal).then(data => ({ data }))
      })
      // On Retina/phone screens, draw 256px tiles at 128 CSS px so photos land 1:1
      // on device pixels (one zoom level sharper) instead of being stretched 2×
      const esriTileSize = window.devicePixelRatio >= 2 ? 128 : 256
      const map = new ml.Map({
        container: mapDivRef.current,
        style: {
          version: 8,
          sources: {
            // Mapbox Satellite (sharper, more current) when a token is configured;
            // falls back to Esri World Imagery otherwise — see .env.local.example.
            satellite: MAPBOX_TOKEN
              ? { type: 'raster', tiles: [`https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token=${MAPBOX_TOKEN}`], tileSize: 512, maxzoom: 22 }
              : { type: 'raster', tiles: ['esri-hd://{z}/{y}/{x}'], tileSize: esriTileSize, maxzoom: 21 },
            labels:    { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'], tileSize: 256 },
          },
          layers: [
            { id: 'satellite-layer', type: 'raster', source: 'satellite' },
            { id: 'labels-layer',    type: 'raster', source: 'labels', paint: { 'raster-opacity': 0.75 } },
          ],
          glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
        },
        center: [-98.5, 39.8], zoom: 4, maxZoom: 21, attributionControl: false,
        // @ts-ignore — preserveDrawingBuffer needed for canvas.toDataURL()
        preserveDrawingBuffer: true,
      })
      map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right')
      mapRef.current = map

      // MapLibre only tracks window resizes; the container also shrinks to a
      // preview once the price is unlocked (see `compact`).
      const ro = new ResizeObserver(() => mapRef.current?.resize())
      ro.observe(mapDivRef.current)
      map.once('remove', () => ro.disconnect())

      // Intro: hold the wide continental view for a beat so it's visible
      // loading in, then swoop into the service area.
      map.once('load', () => {
        setMapReady(true)
        if (staffMode) return
        setTimeout(() => {
          mapRef.current?.flyTo({ center: [OFFICE_LNG, OFFICE_LAT], zoom: 10.5, duration: 1800 })
        }, 1000)
      })
      } catch { /* map unavailable — user sees the static fallback UI */ }
    })()
    return () => { alive = false; cancelAnimationFrame(rafRef.current); mapRef.current?.remove(); mapRef.current = null }
  }, [staffMode])

  /* ─── Final sq ft counter (on completion) ───────────── */
  useEffect(() => {
    if (!lawnSqFt) return
    setAnimSqFt(0)
    const dur = 1000, t0 = performance.now()
    const tick = (now: number) => {
      const p = Math.min((now - t0) / dur, 1)
      setAnimSqFt(Math.round(easeInOut(p) * lawnSqFt))
      if (p < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [lawnSqFt])

  /* ─── Live counter (during drawing) ─────────────────── */
  useEffect(() => {
    const pts = drawRef.current.points
    const target = pts.length >= 2 ? polygonSqFt(pts) : 0
    const from = liveRef.current
    if (target === from) return
    const diff = target - from
    const dur = 350, t0 = performance.now()
    const tick = (now: number) => {
      const p = Math.min((now - t0) / dur, 1)
      const ease = 1 - Math.pow(1 - p, 3)
      const val = Math.round(from + diff * ease)
      setLiveSqFt(val)
      if (p < 1) { rafRef.current = requestAnimationFrame(tick) }
      else { liveRef.current = target }
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [drawCount])

  /* ─── Derive lawnSqFt from sections ─────────────────── */
  useEffect(() => {
    const total = sections.reduce((s, sec) => s + sec.sqFt, 0)
    setLawnSqFt(total > 0 ? total : null)
  }, [sections])

  /* ─── Sync sections → map ────────────────────────────── */
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    if (!map.getSource('sections-data')) {
      map.addSource('sections-data', { type: 'geojson', data: sectionsGeoJSON(sections) })
      map.addLayer({ id: 'sections-fill', type: 'fill', source: 'sections-data', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.25 } })
      map.addLayer({ id: 'sections-outline', type: 'line', source: 'sections-data', paint: { 'line-color': ['get', 'color'], 'line-width': 2.5 } })
    }
    const src = map.getSource('sections-data') as any
    if (src) src.setData(sectionsGeoJSON(sections))
  }, [sections, mapReady])


  /* ─── Address autocomplete ──────────────────────────── */
  const closeSuggestions = useCallback(() => {
    suggestionVersion.current++
    if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current)
    suggestAbortRef.current?.abort()
    setSuggestions([]); setActiveSug(-1)
  }, [])

  const fetchSuggestions = useCallback((query: string) => {
    closeSuggestions()
    if (query.trim().length < 3) return
    const version = suggestionVersion.current
    suggestTimerRef.current = setTimeout(async () => {
      const request = new AbortController()
      suggestAbortRef.current = request
      try {
        const hits = await photonSearch(query, 5, request.signal)
        if (version === suggestionVersion.current && document.activeElement === addressInputRef.current) setSuggestions(hits)
      } catch { /* Typed final search remains available when suggestions fail. */ }
    }, 350)
  }, [closeSuggestions])

  const invalidateSearch = useCallback(() => {
    searchVersion.current++
    searchAbortRef.current?.abort()
    mapRef.current?.stop()
  }, [])


  const pickSuggestion = (s: GeoResult) => {
    closeSuggestions(); invalidateSearch()
    pickedRef.current = s
    setAddress(s.label); setPropertyConfirmation(null); setJobLatLng(null); setStep('idle'); setError('')
  }

  useEffect(() => () => {
    suggestionVersion.current++
    searchVersion.current++
    if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current)
    suggestAbortRef.current?.abort(); searchAbortRef.current?.abort()
  }, [])

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (addressWrapRef.current && !addressWrapRef.current.contains(e.target as Node))
        closeSuggestions()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [closeSuggestions])

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (teaserWrapRef.current && !teaserWrapRef.current.contains(e.target as Node))
        setTeaserTip(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  /* ─── Draw helpers ───────────────────────────────────── */
  const updateDrawSource = useCallback(() => {
    const map = mapRef.current
    const pts = drawRef.current.points
    const src = map?.getSource('draw-data') as any
    if (!src || !pts.length) return
    const features: any[] = []
    // Polygon fill is handled by canvas — only lines + vertices here
    features.push({ type: 'Feature', properties: { t: 'line' }, geometry: { type: 'LineString', coordinates: pts } })
    pts.forEach(p => features.push({ type: 'Feature', properties: { t: 'pt' }, geometry: { type: 'Point', coordinates: p } }))
    src.setData({ type: 'FeatureCollection', features })
  }, [])

  const stopDraw = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    const d = drawRef.current
    if (d.clickFn)   map.off('click',     d.clickFn)
    if (d.moveFn)    map.off('mousemove', d.moveFn)
    if (d.mapMoveFn) map.off('move',      d.mapMoveFn)
    d.clickFn = null; d.moveFn = null; d.mapMoveFn = null; d.points = []
    cursorLngLatRef.current = null
    // Clear the canvas preview line
    const canvas = previewCanvasRef.current
    if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    map.doubleClickZoom.enable()
    map.getCanvas().style.cursor = ''
    ;['draw-line','draw-vertices'].forEach(id => { try { map.getLayer(id) && map.removeLayer(id) } catch {} })
    ;['draw-data'].forEach(id => { try { map.getSource(id) && map.removeSource(id) } catch {} })
    setIsDrawing(false); setDrawCount(0); setPtCount(0)
    setLiveSqFt(0); liveRef.current = 0
  }, [])

  const savePolygon = useCallback((pts: [number, number][]) => {
    if (pts.length < 3) return
    const closed = [...pts, pts[0]]
    const sqFt   = polygonSqFt(pts)
    const map = mapRef.current
    if (map && !map.getSource('sections-data')) {
      map.addSource('sections-data', { type: 'geojson', data: sectionsGeoJSON([]) })
      map.addLayer({ id: 'sections-fill',    type: 'fill', source: 'sections-data', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.25 } })
      map.addLayer({ id: 'sections-outline', type: 'line', source: 'sections-data', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 2.5 } })
    }
    setSections(prev => [...prev, { id: uid(), name: prev.length === 0 ? 'Lawn' : `Zone ${prev.length + 1}`, sqFt, coords: closed }])
  }, [])

  /* ─── Add-on area polygon overlay (fert / mulch) ────── */
  const drawAddonPolygon = useCallback((coords: [number, number][], target: DrawableAddonKey) => {
    const map = mapRef.current
    if (!map) return
    const color = ADDON_META[target].color
    const data = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coords] } }
    const src = map.getSource('addon-data') as any
    if (src) {
      src.setData(data)
    } else {
      map.addSource('addon-data', { type: 'geojson', data })
      map.addLayer({ id: 'addon-fill',    type: 'fill', source: 'addon-data', paint: { 'fill-color': color, 'fill-opacity': 0.25 } })
      map.addLayer({ id: 'addon-outline', type: 'line', source: 'addon-data', paint: { 'line-color': color, 'line-width': 2.5 } })
      return
    }
    map.setPaintProperty('addon-fill', 'fill-color', color)
    map.setPaintProperty('addon-outline', 'line-color', color)
  }, [])

  const removeAddonPolygon = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    ;['addon-fill', 'addon-outline'].forEach(id => { try { map.getLayer(id) && map.removeLayer(id) } catch {} })
    try { map.getSource('addon-data') && map.removeSource('addon-data') } catch {}
  }, [])

  const commitPolygon = useCallback((pts: [number, number][]) => {
    if (pts.length < 3) return
    stopDraw()
    if (addonDrawTarget) {
      const sqFt = polygonSqFt(pts)
      drawAddonPolygon([...pts, pts[0]], addonDrawTarget)
      if (addonDrawTarget === 'fertilization')  { setFertCustomSqFt(sqFt); setFertAreaChoice('custom') }
      else if (addonDrawTarget === 'mulch')     { setMulchCustomSqFt(sqFt); setMulchAreaChoice('custom') }
      else                                      { setYardCustomSqFt(sqFt); setYardAreaChoice('custom') }
      setAddonDrawTarget(null)
      scrollToNext(addonsRef, 'center')
      return
    }
    savePolygon(pts)
    setStep('done')
    if (!staffQuote) trackQuoteLawnTraced()
  }, [staffQuote, stopDraw, savePolygon, addonDrawTarget, drawAddonPolygon])

  const startDraw = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    stopDraw()

    map.doubleClickZoom.disable()
    map.getCanvas().style.cursor = MOWER_CURSOR
    drawRef.current.points = []

    map.addSource('draw-data', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'draw-line',     type: 'line',   source: 'draw-data', filter: ['==', ['get', 't'], 'line'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#52b788', 'line-width': 2.5 } })
    map.addLayer({ id: 'draw-vertices', type: 'circle', source: 'draw-data', filter: ['==', ['get', 't'], 'pt'],   paint: { 'circle-radius': 5, 'circle-color': '#52b788', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } })

    // Canvas draws both the polygon preview fill and the rubber-band line — no MapLibre worker
    const drawPreview = (cursor: [number, number]) => {
      const canvas = previewCanvasRef.current
      const container = mapDivRef.current
      if (!canvas || !container) return
      const dpr = window.devicePixelRatio || 1
      const w = container.clientWidth
      const h = container.clientHeight
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width  = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const d = drawRef.current
      if (!d.points.length) return
      ctx.save()
      ctx.scale(dpr, dpr)

      // Semi-transparent polygon fill including cursor as next vertex
      if (d.points.length >= 2) {
        const allPts = [...d.points, cursor]
        const firstPx = map.project(allPts[0] as any)
        ctx.beginPath()
        ctx.moveTo(firstPx.x, firstPx.y)
        for (let i = 1; i < allPts.length; i++) {
          const px = map.project(allPts[i] as any)
          ctx.lineTo(px.x, px.y)
        }
        ctx.closePath()
        ctx.fillStyle   = '#52b788'
        ctx.globalAlpha = 0.15
        ctx.fill()
        ctx.setLineDash([])
        ctx.strokeStyle = '#52b788'
        ctx.lineWidth   = 1
        ctx.globalAlpha = 0.25
        ctx.stroke()
        ctx.globalAlpha = 1
      }

      // Rubber-band dashed line from last confirmed point to cursor
      const last     = d.points[d.points.length - 1]
      const lastPx   = map.project(last as any)
      const cursorPx = map.project(cursor as any)
      ctx.beginPath()
      ctx.setLineDash([8, 6])
      ctx.strokeStyle = '#95dbb8'
      ctx.lineWidth   = 2
      ctx.globalAlpha = 0.85
      ctx.lineCap     = 'round'
      ctx.moveTo(lastPx.x, lastPx.y)
      ctx.lineTo(cursorPx.x, cursorPx.y)
      ctx.stroke()
      ctx.restore()
    }

    let lastLiveUpdate = 0
    const clickFn = (e: any) => {
      const d = drawRef.current
      d.points = [...d.points, [e.lngLat.lng, e.lngLat.lat]]
      updateDrawSource()
      setPtCount(d.points.length)
      setDrawCount(c => c + 1)
    }

    const moveFn = (e: any) => {
      const cursor: [number, number] = [e.lngLat.lng, e.lngLat.lat]
      cursorLngLatRef.current = cursor
      const d = drawRef.current
      if (!d.points.length) return
      drawPreview(cursor)
      // Update live sq ft at ~30fps so React re-renders stay cheap
      const now = Date.now()
      if (d.points.length >= 2 && now - lastLiveUpdate > 33) {
        lastLiveUpdate = now
        setLiveSqFt(polygonSqFt([...d.points, cursor]))
      }
    }

    const mapMoveFn = () => {
      if (cursorLngLatRef.current && drawRef.current.points.length)
        drawPreview(cursorLngLatRef.current)
    }

    drawRef.current.clickFn   = clickFn
    drawRef.current.moveFn    = moveFn
    drawRef.current.mapMoveFn = mapMoveFn
    map.on('click',     clickFn)
    map.on('mousemove', moveFn)
    map.on('move',      mapMoveFn)
    setIsDrawing(true)
  }, [stopDraw, updateDrawSource])

  /* ─── Add-on area draw controls ─────────────────────── */
  const startAddonDraw = useCallback((target: DrawableAddonKey) => {
    setOpenAddon(target)
    setAddonDrawTarget(target)
    startDraw()
    requestAnimationFrame(() => mapDivRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }, [startDraw])

  const cancelAddonDraw = useCallback(() => {
    stopDraw()
    setAddonDrawTarget(null)
  }, [stopDraw])

  const resetFertArea = useCallback(() => {
    removeAddonPolygon()
    setFertAreaChoice(null); setFertCustomSqFt(null)
  }, [removeAddonPolygon])

  const resetMulchArea = useCallback(() => {
    removeAddonPolygon()
    setMulchAreaChoice(null); setMulchCustomSqFt(null)
  }, [removeAddonPolygon])

  const resetYardArea = useCallback(() => {
    removeAddonPolygon()
    setYardAreaChoice(null); setYardCustomSqFt(null); setYardHazards([])
  }, [removeAddonPolygon])

  const toggleYardHazard = useCallback((key: string) => {
    setYardHazards(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }, [])

  /* ─── Finish button ──────────────────────────────────── */
  const handleFinish = useCallback(() => {
    commitPolygon(drawRef.current.points)
  }, [commitPolygon])

  /* ─── Finish & immediately draw another zone ─────────── */
  const handleFinishAndAdd = useCallback(() => {
    const pts = [...drawRef.current.points]
    if (pts.length < 3) return
    stopDraw()
    savePolygon(pts)
    setStep('editing')
    startDraw()
  }, [stopDraw, savePolygon, startDraw])

  /* ─── Parcel boundary overlay ────────────────────────── */
  const drawParcelBoundary = useCallback((coords: [number, number][]) => {
    const map = mapRef.current
    if (!map) return
    try { map.getLayer('parcel-outline') && map.removeLayer('parcel-outline') } catch {}
    try { map.getSource('parcel-boundary') && map.removeSource('parcel-boundary') } catch {}
    map.addSource('parcel-boundary', {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} },
    })
    map.addLayer({
      id: 'parcel-outline',
      type: 'line',
      source: 'parcel-boundary',
      paint: { 'line-color': '#ffffff', 'line-width': 1.5, 'line-opacity': 0.45, 'line-dasharray': [4, 3] },
    })
  }, [])

  // The pin must describe the same point that is saved. A nearby parcel with
  // the same house number is not enough evidence to move it to another house.
  useEffect(() => {
    if (!mapReady || !jobLatLng || !mapRef.current) return
    let alive = true
    let marker: { remove(): void } | null = null
    import('maplibre-gl').then(({ default: ml }) => {
      if (!alive || !mapRef.current) return
      const el = document.createElement('div')
      el.className = 'crm-house-pin'
      el.title = 'Property location — check the house before tracing'
      el.innerHTML = '<svg width="30" height="40" viewBox="0 0 30 40"><path d="M15 39C15 39 2 23.5 2 14a13 13 0 0 1 26 0c0 9.5-13 25-13 25z" fill="currentColor" stroke="#fff" stroke-width="2.5"/><circle cx="15" cy="14" r="5" fill="#fff"/></svg>'
      el.style.pointerEvents = 'none'
      marker = new ml.Marker({ element: el, anchor: 'bottom' }).setLngLat([jobLatLng.lng, jobLatLng.lat]).addTo(mapRef.current)
    })
    return () => { alive = false; marker?.remove() }
  }, [mapReady, jobLatLng])

  const clearPropertyMeasurements = useCallback(() => {
    setSections([]); setLawnSqFt(null); sectionsCountRef.current = 0
    drawRef.current.points = []; setPtCount(0)
    setFertAreaChoice(null); setFertCustomSqFt(null); setFertIncluded(false)
    setMulchAreaChoice(null); setMulchCustomSqFt(null); setMulchIncluded(false)
    setYardAreaChoice(null); setYardCustomSqFt(null); setYardIncluded(false); setYardHazards([])
    setAddonDrawTarget(null); removeAddonPolygon()
    const map = mapRef.current
    if (map?.getLayer('parcel-outline')) map.removeLayer('parcel-outline')
    if (map?.getSource('parcel-boundary')) map.removeSource('parcel-boundary')
  }, [removeAddonPolygon])

  const editAddress = (value: string) => {
    invalidateSearch(); stopDraw()
    pickedRef.current = null
    setAddress(value); setPropertyConfirmation(null); setJobLatLng(null); setCandidateLabel('')
    clearPropertyMeasurements(); setStep('idle'); setError(''); setOutsideArea(false); setWaitlistState('idle')
    sessionStorage.removeItem('qg_submission_waitlist')
    fetchSuggestions(value)
  }

  /* ─── Address search ─────────────────────────────────── */
  const showPropertyCandidate = useCallback((hit: GeoResult, version: number) => {
    const map = mapRef.current
    if (!map || searchVersion.current !== version) return
    stopDraw()
    if (jobLatLng && (jobLatLng.lat !== hit.lat || jobLatLng.lng !== hit.lon)) clearPropertyMeasurements()
    setJobLatLng({ lat: hit.lat, lng: hit.lon }); setCandidateLabel(hit.label)
    setPropertyConfirmation(null)
    const needsConfirmation = !!staffQuote || hit.precision !== 'address'
    const ready = () => {
      if (version !== searchVersion.current) return
      if (needsConfirmation) setStep('confirming')
      else if (sectionsCountRef.current > 0) setStep('done')
      else { startDraw(); setStep('drawing') }
    }
    // Fast lookup should not be hidden behind a multi-second flight animation.
    map.jumpTo({ center: [hit.lon, hit.lat], zoom: 18 })
    ready()
    getParcel(address, hit.lat, hit.lon).then(parcel => {
      if (version === searchVersion.current && parcel) drawParcelBoundary(parcel.coordinates)
    }).catch(() => { /* Parcel outlines are supplemental, not property identity. */ })
  }, [staffQuote, address, jobLatLng, clearPropertyMeasurements, stopDraw, startDraw, drawParcelBoundary])

  const handleSearch = useCallback(async (ev?: React.FormEvent) => {
    ev?.preventDefault()
    if (!address.trim()) { setError('Enter your address to find your property.'); return }
    if (!mapRef.current || !mapReady) { setError('The map is loading. Try again in a moment.'); return }
    invalidateSearch(); closeSuggestions(); stopDraw()
    const version = searchVersion.current
    const request = new AbortController()
    searchAbortRef.current = request
    setPropertyConfirmation(null); setError(''); setOutsideArea(false); setStep('searching')
    const previousWaitlistProperty = sessionStorage.getItem('qg_waitlist_property')
    if (previousWaitlistProperty && address !== previousWaitlistProperty) { sessionStorage.removeItem('qg_submission_waitlist'); setWaitlistState('idle') }
    requestAnimationFrame(() => { if (version === searchVersion.current && (!staffQuote || staffUsed.current)) mapDivRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) })
    try {
      const picked = pickedRef.current
      const hit = picked?.label === address && picked.precision === 'address' ? picked
        : await (staffQuote ? cachedGeocode : geocodeAddress)(address, request.signal)
      if (version !== searchVersion.current || request.signal.aborted) return
      if (!hit) { setError('We could not find an exact property. Check the street number, city and ZIP, or use the location option below.'); setStep('idle'); return }
      const miles = haversineMiles(OFFICE_LAT, OFFICE_LNG, hit.lat, hit.lon)
      if (!staffQuote && miles > SERVICE_RADIUS_MILES) {
        setError(`That address is about ${Math.round(miles).toLocaleString()} miles from us. We serve Austin and up to ${SERVICE_RADIUS_MILES} miles out. Join our waitlist below and we'll contact you if coverage changes.`)
        setOutsideArea(true); sessionStorage.setItem('qg_waitlist_property', address); setStep('idle')
        return
      }
      if (!staffQuote) trackQuoteAddressFound()
      showPropertyCandidate(hit, version)
    } catch {
      if (version !== searchVersion.current || request.signal.aborted) return
      setError('Address lookup is temporarily unavailable. Try again, or use the location option below.'); setStep('idle')
    }
  }, [staffQuote, address, mapReady, invalidateSearch, closeSuggestions, stopDraw, showPropertyCandidate])

  const confirmProperty = () => {
    if (!jobLatLng) return
    setPropertyConfirmation({ ...jobLatLng, address, contactAddress: contactAddressAtReview.current })
    setError('')
    if (sectionsCountRef.current > 0) setStep('done')
    else { startDraw(); setStep('drawing') }
  }

  const locateManually = () => {
    if (!mapReady || !mapRef.current) { setError('The map is loading. Try again in a moment.'); return }
    const point = parseManualPropertyLocation(manualLocation)
    if (!point || !address.trim()) { setError('Enter the full property address and a Google Maps place URL or latitude, longitude. A shortened link or map viewport alone cannot identify a house.'); return }
    invalidateSearch(); closeSuggestions()
    showPropertyCandidate({ label: address, lat: point.lat, lon: point.lng, precision: 'approximate' }, searchVersion.current)
  }

  useEffect(() => {
    if (!staffQuote || !mapReady || restored.current) return
    const frame = requestAnimationFrame(() => {
    restored.current = true
    if (draft?.jobLatLng) {
      mapRef.current?.jumpTo({ center: [draft.jobLatLng.lng, draft.jobLatLng.lat], zoom: 18 })
      setSections([...draft.sections])
      const confirmed = !staffQuote.addressNeedsReview || isPropertyConfirmed(draft.propertyConfirmation, draft.address, contactAddressAtReview.current, draft.jobLatLng)
      setCandidateLabel(draft.address)
      setStep(confirmed ? (draft.sections.length ? 'done' : 'confirming') : 'confirming')
      if (confirmed && draft.unfinishedPoints?.length) {
        startDraw()
        drawRef.current.points = draft.unfinishedPoints
        setAddonDrawTarget(draft.unfinishedTarget ?? null)
        setStep('editing')
        setPtCount(draft.unfinishedPoints.length)
        updateDrawSource()
      }
    } else if ((draft?.address || staffQuote.address) && !staffQuote.addressNeedsReview) {
      void handleSearch()
    }
    })
    return () => cancelAnimationFrame(frame)
  }, [staffQuote, draft, mapReady, address, handleSearch, startDraw, updateDrawSource])

  /* ─── Cancel current trace (keep address/map position) ── */
  const cancelTrace = useCallback(() => {
    if (step === 'editing') {
      stopDraw()
      setStep('done')
    } else {
      stopDraw()
      startDraw()
    }
  }, [step, stopDraw, startDraw])

  /* ─── Manual sq ft entry ────────────────────────────── */
  const handleManualSqFt = useCallback(() => {
    const val = parseInt(manualSqFtInput.replace(/\D/g, ''), 10)
    if (!val || val < 100) return
    stopDraw()
    setSections([{ id: uid(), name: 'Lawn', sqFt: val, coords: null }])
    setShowManualSqFt(false)
    setManualSqFtInput('')
    setStep('done')
    if (!staffQuote) trackQuoteLawnTraced()
  }, [staffQuote, manualSqFtInput, stopDraw])

  /* ─── Edit mode ──────────────────────────────────────── */
  const enterEditMode = useCallback(() => {
    setStep('editing')
    startDraw()
  }, [startDraw])

  const deleteSection = useCallback((id: string) => {
    setSections(prev => prev.filter(s => s.id !== id))
  }, [])

  /* ─── Reset ──────────────────────────────────────────── */
  const handleReset = useCallback(() => {
    invalidateSearch(); closeSuggestions(); pickedRef.current = null
    setPropertyConfirmation(null); setCandidateLabel(''); setManualLocation(''); setWaitlistState('idle')
    sessionStorage.removeItem('qg_submission_waitlist'); sessionStorage.removeItem('qg_waitlist_property')
    cancelAnimationFrame(rafRef.current)
    stopDraw()
    const map = mapRef.current
    if (map) {
      ;['sections-fill','sections-outline','parcel-outline'].forEach(id => { try { map.getLayer(id) && map.removeLayer(id) } catch {} })
      ;['sections-data','parcel-boundary'].forEach(id => { try { map.getSource(id) && map.removeSource(id) } catch {} })
      map.flyTo({ center: [-98.5, 39.8], zoom: 4, duration: 1200 })
    }
    removeAddonPolygon()
    setStep('idle'); setAddress(''); setError(''); setSuggestions([])
    setLawnSqFt(null); setAnimSqFt(0); setSections([]); setLastMow('thisweek'); setJobLatLng(null)
    setLeadUnlocked(!!staffQuote); setLeadToken(undefined); if (!staffQuote) { sessionStorage.removeItem('qg_lead_token'); sessionStorage.removeItem('qg_submission_map'); sessionStorage.removeItem('qg_submission_booking') };  setLeadPhone(''); setLeadConsent(false); setLeadStatus('idle'); setLeadError('')
    setOpenAddon(null); setAddonDrawTarget(null); setTeaserTip(null)
    setFertAreaChoice(null); setFertCustomSqFt(null); setFertIncluded(false)
    setMulchAreaChoice(null); setMulchCustomSqFt(null); setMulchDepthIn(MULCH_DEFAULT_DEPTH_IN); setMulchIncluded(false)
    setLeafIncluded(false); setLeafHaulAway(false)
    setMaintenanceInterested(false)
    setYardAreaChoice(null); setYardCustomSqFt(null); setYardSeverity('moderate'); setYardHazards([]); setYardIncluded(false)
    scrollToNext(addressWrapRef, 'center')
  }, [staffQuote, stopDraw, removeAddonPolygon, invalidateSearch, closeSuggestions])

  /* ─── Lead capture (unlock price) ───────────────────── */
  const captureMapScreenshot = useCallback((): Promise<string> => {
    return new Promise(resolve => {
      const map = mapRef.current
      if (!map) { resolve(''); return }
      map.triggerRepaint()
      map.once('render', () => {
        const src = map.getCanvas()
        const offscreen = document.createElement('canvas')
        offscreen.width = src.width
        offscreen.height = src.height
        offscreen.getContext('2d')?.drawImage(src, 0, 0)
        resolve(offscreen.toDataURL('image/jpeg', 0.8))
      })
    })
  }, [])

  const handleLeadSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (staffQuote) return
    if (!leadConsent) { setLeadError('Please check the box to consent to being contacted.'); return }
    setLeadStatus('submitting'); setLeadError('')
    const screenshot = await captureMapScreenshot()
    const shown = shownQuote.current
    const result = await submitLead({ submission_id: submissionId('map'), phone: leadPhone, address, sq_ft: lawnSqFt, consent: leadConsent, consentText: LEAD_CONSENT_TEXT, map_screenshot: screenshot || undefined,
      website_price: shown?.price, lawn_tracing: shown?.tracing, ...getAttribution() })
      .catch(() => ({ success: false, error: 'Something went wrong. Please try again.', leadToken: undefined, eventId: undefined }))
    if (result.success) { trackWebsiteLead(result.eventId); setLeadToken(result.leadToken); if (result.leadToken) sessionStorage.setItem('qg_lead_token', result.leadToken); setLeadUnlocked(true); setLeadStatus('idle'); if (!staffQuote) trackQuoteShown() }
    else { setLeadStatus('idle'); setLeadError(result.error ?? 'Something went wrong.') }
  }, [staffQuote, leadPhone, leadConsent, address, lawnSqFt, captureMapScreenshot])

  /* ─── Booking modal ─────────────────────────────────── */
  useEffect(() => {
    if (!showBooking) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeBooking() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showBooking])

  /* ─── Pricing ────────────────────────────────────────── */
  const season         = getSeasonInfo(new Date().getMonth())
  const mowWeeks       = LAST_MOW_WEEKS[lastMow] ?? 0.5
  const { fee: overgrowthFee, label: overgrowthLabel } = calcOvergrowthFee(mowWeeks, season.multiplier)
  const jobMiles       = jobLatLng ? haversineMiles(OFFICE_LAT, OFFICE_LNG, jobLatLng.lat, jobLatLng.lng) : 0
  const { fee: distanceFee, label: distanceLabel } = calcDistanceFee(jobMiles)
  const basePrice      = lawnSqFt ? calcPrice(lawnSqFt) : 0
  const discount       = FREQ[freq].discount
  const ongoingPrice   = lawnSqFt ? Math.round(basePrice * (1 - discount / 100)) + distanceFee : 0
  const firstVisitFullPrice = ongoingPrice + overgrowthFee
  const firstVisitPrice = Math.round(firstVisitFullPrice * (1 - FIRST_VISIT_DISCOUNT_PCT / 100))
  const mowingPriceCents = Math.round((overridePrice ?? ongoingPrice) * 100)
  const staffTotalCents = (includeMowing ? mowingPriceCents : 0) + manualLines.reduce((sum, line) => sum + line.amountCents, 0) - discountCents
  const isDone         = step === 'done' || step === 'editing'

  // Keep what the customer sees ready for the unlock submit, and once unlocked, save frequency/price changes to their lead.
  const quoteKey = `${freq}:${ongoingPrice}:${firstVisitPrice}`
  const sentQuote = useRef<string | null>(null)
  useEffect(() => {
    if (staffQuote) return
    shownQuote.current = { price: { price_per_visit: ongoingPrice, first_visit_price: firstVisitPrice, frequency: freq },
      tracing: sections.map(({ name, sqFt, coords }) => ({ name, sqFt, coords })) }
  }, [staffQuote, ongoingPrice, firstVisitPrice, freq, sections])
  useEffect(() => {
    if (!leadToken) sentQuote.current = null
    if (staffQuote || !leadUnlocked || !leadToken || ongoingPrice <= 0) return
    if (sentQuote.current === null) { sentQuote.current = quoteKey; return }
    if (sentQuote.current === quoteKey) return
    const timer = setTimeout(() => {
      sentQuote.current = quoteKey
      void updateWebsitePrice(leadToken, { price_per_visit: ongoingPrice, first_visit_price: firstVisitPrice, frequency: freq }).catch(() => {})
    }, 800)
    return () => clearTimeout(timer)
  }, [staffQuote, leadUnlocked, leadToken, quoteKey, ongoingPrice, firstVisitPrice, freq])
  // Once the price is unlocked the map shrinks to a preview and the quote takes over
  const compact        = !staffQuote && leadUnlocked && step === 'done' && !isDrawing

  // Lawn finished → phone box; price unlocked (or extra area added) → price
  useEffect(() => {
    if (step !== 'done' || (staffQuote && !staffUsed.current)) return
    if (leadUnlocked) { scrollToNext(priceTitleRef); return }
    scrollToNext(leadGateRef, 'center')
    // Only jump into the field with a mouse — on phones it would pop the keyboard over the map
    if (window.matchMedia('(pointer: fine)').matches)
      setTimeout(() => leadPhoneRef.current?.focus({ preventScroll: true }), 450)
  }, [step, leadUnlocked, staffQuote])

  // Re-frame the traced lawn whenever the map changes size between full and preview
  useEffect(() => {
    const map = mapRef.current
    const pts = sections.flatMap(s => s.coords ?? [])
    if (!map || pts.length < 3) return
    const lngs = pts.map(p => p[0]), lats = pts.map(p => p[1])
    const t = setTimeout(() => {
      map.resize()
      map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 28, duration: 600, maxZoom: 20 })
    }, 380)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact])

  /* ─── Add-on pricing ─────────────────────────────────── */
  const fertSqFt   = fertAreaChoice === 'same' ? lawnSqFt : fertAreaChoice === 'custom' ? fertCustomSqFt : null
  const fertPrice  = fertSqFt ? calcFertPrice(fertSqFt) : 0

  const mulchSqFt  = mulchAreaChoice === 'same' ? lawnSqFt : mulchAreaChoice === 'custom' ? mulchCustomSqFt : null
  const mulchCuYd  = mulchSqFt ? calcMulchCuYd(mulchSqFt, mulchDepthIn) : 0
  const mulchPrice = mulchSqFt ? calcMulchPrice(mulchSqFt, mulchDepthIn) : 0

  const leafPrice  = lawnSqFt ? calcLeafPrice(lawnSqFt, leafHaulAway) : 0

  const yardSqFt       = yardAreaChoice === 'same' ? lawnSqFt : yardAreaChoice === 'custom' ? yardCustomSqFt : null
  const yardBasePrice  = yardSqFt ? calcClearoutPrice(yardSqFt, yardSeverity) : 0
  const yardHasHazard  = yardHazards.length > 0
  const yardHazardFee  = yardHasHazard ? Math.round(yardBasePrice * CLEAROUT_HAZARD_SURCHARGE_PCT / 100) : 0
  const yardPrice      = yardBasePrice + yardHazardFee

  const addonInterest = (() => {
    const obj: Record<string, unknown> = {}
    if (fertIncluded && fertSqFt) obj.fertilization = { included: true, sq_ft: fertSqFt, price: fertPrice, area: fertAreaChoice }
    if (mulchIncluded && mulchSqFt) obj.mulch = { included: true, sq_ft: mulchSqFt, depth_in: mulchDepthIn, cu_yd: Math.round(mulchCuYd * 10) / 10, price: mulchPrice, area: mulchAreaChoice }
    if (leafIncluded && lawnSqFt) obj.leafCleanup = { included: true, sq_ft: lawnSqFt, haul_away: leafHaulAway, price: leafPrice }
    if (maintenanceInterested) obj.maintenance = { interested: true }
    if (yardIncluded && yardSqFt) obj.yardClearout = { included: true, sq_ft: yardSqFt, severity: yardSeverity, hazards: yardHazards, base_price: yardBasePrice, hazard_fee: yardHazardFee, price: yardPrice, area: yardAreaChoice }
    return Object.keys(obj).length ? obj : null
  })()

  useEffect(() => {
    if (showBooking && !bookingPhone && leadPhone) setBookingPhone(leadPhone)
  }, [showBooking, bookingPhone, leadPhone])

  const closeBooking = useCallback(() => {
    setShowBooking(false); setBookingStatus('idle'); setBookingError(''); setMapScreenshot('')
  }, [])

  const handleBookingSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (staffQuote) return
    setBookingStatus('submitting'); setBookingError('')
    const result = await submitBooking({
      submission_id: submissionId('booking'), lead_token: leadToken ?? sessionStorage.getItem('qg_lead_token') ?? undefined,
      name: bookingName, phone: bookingPhone, email: bookingEmail,
      preferred_date: bookingDate ? bookingDate.toLocaleDateString('en-CA') : '',
      preferred_time: bookingTimeWindow, notes: bookingNotes, address,
      sq_ft: lawnSqFt, frequency: FREQ[freq].label, one_time: freq === 'onetime',
      price_per_visit: ongoingPrice, first_visit_price: firstVisitPrice,
      overgrowth_fee: overgrowthFee, last_mow: lastMow,
      distance_miles: Math.round(jobMiles * 10) / 10, distance_fee: distanceFee,
      map_screenshot: mapScreenshot,
      addon_interest: addonInterest,
      lawn_tracing: sections.map(({ name, sqFt, coords }) => ({ name, sqFt, coords })),
      ...getAttribution(),
    }).catch(() => ({ success: false, error: 'Something went wrong. Please try again.' }))
    if (result.success) { setBookingStatus('success'); if (!staffQuote) trackBookingRequested(firstVisitPrice) }
    else { setBookingStatus('idle'); setBookingError(result.error ?? 'Something went wrong.') }
  }, [leadToken, staffQuote, bookingName, bookingPhone, bookingEmail, bookingDate, bookingTimeWindow, bookingNotes, address, lawnSqFt, freq, ongoingPrice, firstVisitPrice, overgrowthFee, lastMow, jobMiles, distanceFee, addonInterest, sections])

  async function saveStaffDraft(confirmed: boolean) {
    if (!staffQuote || saving) return
    if (confirmed && staffQuote.addressNeedsReview && (jobLatLng || sections.length) && !isPropertyConfirmed(propertyConfirmation, address, contactAddressAtReview.current, jobLatLng)) { setSaveMessage('Confirm the property on the map before saving this measured quote as quoted.'); return }
    setSaving(true); setSaveMessage('')
    // Preserve unfinished trace points separately from finished/priced measurements.
    const points = drawRef.current.points
    const savedSections = sections
    const next: QuoteDraft = {
      contactAddressAtReview: contactAddressAtReview.current, propertyConfirmation, address, sections: savedSections, unfinishedPoints: points, unfinishedTarget: addonDrawTarget, jobLatLng, freq, lastMow,
      fertAreaChoice, fertCustomSqFt, fertIncluded, mulchAreaChoice, mulchCustomSqFt, mulchDepthIn, mulchIncluded,
      leafIncluded, leafHaulAway, maintenanceInterested, yardAreaChoice, yardCustomSqFt, yardSeverity, yardHazards, yardIncluded,
      addonInterest, overgrowthFee, calculatedPrice: ongoingPrice, calculatedFirstVisit: firstVisitPrice, overridePrice, notes: staffNotes,
      includeMowing, manualLines, discountCents, totalCents: staffTotalCents,
    }
    try {
      const result = await saveLeadQuote(staffQuote.id, staffQuote.updated_at, next, confirmed)
      if ('error' in result) setSaveMessage(result.error)
      else {
        staffQuote.onSaved?.(result.updatedAt, confirmed, next)
        setSaveMessage(confirmed ? 'Saved as quoted. Nothing was sent to the customer.' : 'Price saved.')
      }
    } catch { setSaveMessage('Could not save. Please retry.') }
    finally { setSaving(false) }
  }

  /* ─── JSX ────────────────────────────────────────────── */
  return (
    <section className={`mapq-section${staffQuote ? ' crm-staff-map' : ''}${staffQuote && !showStaffMap ? ' crm-staff-map-hidden' : ''}${outsideArea ? ' mapq-outside' : ''}`} id="map-quote"
      onPointerDownCapture={() => { staffUsed.current = true }} onKeyDownCapture={() => { staffUsed.current = true }}>
      <div className="mapq-blobs" aria-hidden="true">
        <div className="mapq-blob mapq-blob-a" />
        <div className="mapq-blob mapq-blob-b" />
      </div>

      <div className="mapq-inner">
        {staffQuote && <div className="staff-quote-controls">
          <h2>Price</h2>
          <p>Build the price for this lead. Saving never contacts the customer.</p>
          <QuotePriceEditor lines={manualLines} onLinesChange={setManualLines} discountCents={discountCents} onDiscountChange={setDiscountCents} includeMowing={includeMowing} onIncludeMowingChange={included => { setIncludeMowing(included); if (included) setShowStaffMap(true) }} mowingPriceCents={mowingPriceCents}
            lawn={{ sqFt: lawnSqFt, freq, freqOptions: (Object.entries(FREQ) as [Frequency, typeof FREQ[Frequency]][]).map(([value, f]) => ({ value, label: f.discount ? `${f.label} (−${f.discount}%)` : f.label })),
              onFreqChange: value => setFreq(value as Frequency), calculatedCents: Math.round(ongoingPrice * 100), overridePrice, onOverrideChange: setOverridePrice }} />
          <label>Notes for this quote<textarea aria-label="Quote notes" value={staffNotes} onChange={e => setStaffNotes(e.target.value)} maxLength={4000} placeholder="Anything the price depends on" /></label>
          <div className="staff-quote-actions">
            <button disabled={saving || staffQuote.quote_status === 'accepted'} onClick={() => void saveStaffDraft(false)}>Save</button>
            <button disabled={saving || (isDrawing && includeMowing) || staffQuote.quote_status === 'accepted'} onClick={() => void saveStaffDraft(true)}>Save as quoted</button>
          </div>
          <p className="staff-quote-hint">{isDrawing && includeMowing ? 'Finish the lawn trace on the map (or uncheck lawn care) before saving as quoted.' : '“Save as quoted” means you’ve given (or are about to give) the customer this price.'}</p>
          {staffQuote.quote_status === 'accepted' && <p>This price was accepted and is locked.</p>}
          <p role="status">{saveMessage}</p>
        </div>}
        {staffQuote && <div className="crm-map-heading"><span>Property map</span><button type="button" className="crm-map-toggle" onClick={() => setShowStaffMap(open => !open)}>{showStaffMap ? 'Hide map' : 'Open map'}</button></div>}
        <div className="mapq-header">
          <div className="section-label" style={{ color: 'var(--green-bright)' }}>Instant Quote</div>
          <h2 className="section-h2" style={{ color: '#fff', marginBottom: 0 }}>
            Trace your lawn.{' '}
            <em style={{ color: 'var(--green-bright)', fontStyle: 'italic' }}>Get your price.</em>
          </h2>
          {/* The deal and the effort, upfront — before anyone has to start */}
          <ul className="mapq-facts">
            <li className="mapq-fact mapq-fact-deal">
              <span className="mapq-fact-badge">{FIRST_VISIT_DISCOUNT_PCT}% OFF</span>
              your first mow
            </li>
            <li className="mapq-fact">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
              Your price in about a minute
            </li>
            <li className="mapq-fact">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
              No payment now
            </li>
          </ul>
          {/* Obvious way out for anyone who doesn't want to draw on a map */}
          <div className="mapq-fallback">
            {!staffQuote && <ManualQuoteForm />}
          </div>
          <button
            type="button"
            className="mapq-services-toggle"
            aria-expanded={servicesOpen}
            onClick={() => { setServicesOpen(o => !o); setTeaserTip(null) }}
          >
            {servicesOpen ? 'Hide other services' : 'Need more than mowing? See other services →'}
          </button>
          {servicesOpen && <div className="mapq-services-teaser" ref={teaserWrapRef}>
            {(Object.keys(ADDON_META) as AddonKey[]).map(key => (
              <button
                key={key}
                type="button"
                className="mapq-services-teaser-pill"
                aria-expanded={teaserTip === key}
                onClick={() => setTeaserTip(prev => prev === key ? null : key)}
              >
                <span className="mapq-services-teaser-dot" style={{ background: ADDON_META[key].color }} />
                {ADDON_META[key].label}
              </button>
            ))}
            <span className="mapq-services-teaser-sub">Each is priced to your yard once we see it. Tap one to learn more.</span>
            {teaserTip && (
              <p className="mapq-services-teaser-info">
                {ADDON_META[teaserTip].blurb}{' '}
                <span className="mapq-services-teaser-price">{ADDON_META[teaserTip].priceHint}</span>
              </p>
            )}
          </div>}
        </div>

        <div className={`mapq-grid${compact ? ' mapq-grid-compact' : ''}`}>
          {/* ── Left panel ── */}
          <div className="mapq-panel">

            {/* Step 1 — Address */}
            <div className="mapq-step">
              <div className={`mapq-step-indicator ${!['idle', 'searching', 'confirming'].includes(step) ? 'done' : 'active'}`}>
                {step !== 'idle' && step !== 'searching' ? <CheckIcon /> : '1'}
              </div>
              <div className="mapq-step-line" style={{ opacity: step !== 'idle' && step !== 'searching' ? 1 : 0.2 }} />
              <div className="mapq-step-body">
                <div className={`mapq-step-title ${step === 'idle' || step === 'searching' ? 'active' : ''}`}>Your address</div>
                {(step === 'idle' || step === 'searching' || step === 'confirming') && (
                  <form onSubmit={handleSearch} style={{ marginTop: 14 }}>
                    <div className="mapq-input-wrap" ref={addressWrapRef}>
                      <svg className="mapq-input-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                      </svg>
                      <input
                        className="mapq-input"
                        type="text"
                        placeholder="123 Main St, Austin TX…"
                        value={address}
                        autoComplete="off"
                        ref={addressInputRef}
                        aria-label="Your street address"
                        aria-autocomplete="list"
                        aria-expanded={suggestions.length > 0}
                        onChange={e => editAddress(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Escape') { closeSuggestions(); return }
                          if (!suggestions.length) return
                          if (e.key === 'ArrowDown') { e.preventDefault(); setActiveSug(i => Math.min(i + 1, suggestions.length - 1)) }
                          else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveSug(i => Math.max(i - 1, -1)) }
                          else if (e.key === 'Enter' && activeSug >= 0) { e.preventDefault(); pickSuggestion(suggestions[activeSug]) }
                          else if (e.key === 'Escape') { closeSuggestions() }
                        }}
                      />
                      {suggestions.length > 0 && (
                        <div className="mapq-suggestions" role="listbox">
                          {suggestions.map((s, i) => (
                            <div
                              key={i}
                              className={`mapq-suggestion${i === activeSug ? ' active' : ''}`}
                              role="option"
                              aria-selected={i === activeSug}
                              onPointerDown={e => { e.preventDefault(); pickSuggestion(s) }}
                            >
                              {s.label}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <button type="submit" className="mapq-btn-primary" style={{ marginTop: 10, width: '100%' }} disabled={step === 'searching'}>
                      {step === 'searching' ? <><span className="mapq-spinner" /> Finding property…</> : 'Find my property →'}
                    </button>
                    {error && <p className="mapq-error">{error}</p>}
                  </form>
                )}
                {step === 'confirming' && jobLatLng && <div className="mapq-property-confirm" role="status">
                  <strong>Check this is the right house</strong>
                  <p>{candidateLabel || address}</p>
                  <p>Compare the pin with the property before tracing. A road or nearby house is not a confirmed match.</p>
                  <button type="button" className="mapq-btn-primary" onClick={confirmProperty}>Confirm this property</button>
                </div>}
                {staffQuote && <details className="mapq-location-help">
                  <summary>Can’t find the property? Set its location</summary>
                  <p>Open the submitted address in Google Maps. Copy the place URL from the browser address bar, or right-click the house to copy its latitude, longitude.</p>
                  <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`} target="_blank" rel="noopener noreferrer">Open address in Google Maps ↗</a>
                  <label>Place URL or latitude, longitude<input aria-label="Property location" value={manualLocation} onChange={event => setManualLocation(event.target.value)} placeholder="30.510755, -97.586527" /></label>
                  <button type="button" className="mapq-btn-ghost" onClick={locateManually}>Show this location</button>
                </details>}
                {!staffQuote && error && !outsideArea && <p className="mapq-location-help"><a href="#service-inquiry">Send your address for a personal quote instead →</a></p>}
                {outsideArea && !staffQuote && (waitlistState === 'saved' ? <p className="mapq-waitlist-success" role="status">You’re on the waitlist. We’ll reach out if service becomes available near this address.</p> :
                  <form className="mapq-waitlist" onSubmit={async event => {
                    event.preventDefault()
                    if (waitlistState === 'saving') return
                    setWaitlistState('saving'); setWaitlistError('')
                    try {
                      const result = await submitWaitlist({ submission_id: submissionId('waitlist'), name: waitlistName, phone: waitlistPhone,
                        address, email: waitlistEmail, ...getAttribution() })
                      if (result.success) setWaitlistState('saved')
                      else { setWaitlistState('idle'); setWaitlistError(result.error ?? 'Could not save your request.') }
                    } catch { setWaitlistState('idle'); setWaitlistError('Could not save your request. Please retry.') }
                  }}>
                    <h3>Join the service waitlist</h3>
                    <label>Your name<input required autoComplete="name" value={waitlistName} onChange={event => setWaitlistName(event.target.value)} maxLength={150} /></label>
                    <label>Phone number<input required type="tel" autoComplete="tel" value={waitlistPhone} onChange={event => setWaitlistPhone(event.target.value)} /></label>
                    <label>Email (optional)<input type="email" autoComplete="email" value={waitlistEmail} onChange={event => setWaitlistEmail(event.target.value)} /></label>
                    <p>Property: {address}</p>
                    <button type="submit" className="mapq-btn-primary" disabled={waitlistState === 'saving'}>{waitlistState === 'saving' ? 'Saving…' : 'Join waitlist'}</button>
                    {waitlistError && <p className="mapq-error" role="alert">{waitlistError}</p>}
                  </form>)}
                {step !== 'idle' && step !== 'searching' && step !== 'confirming' && (
                  <p className="mapq-step-done-text">{address}<button className="mapq-link" onClick={handleReset}> · new search</button></p>
                )}
              </div>
            </div>

            {/* Step 2 — Trace */}
            <div className="mapq-step">
              <div className={`mapq-step-indicator ${isDone && !isDrawing ? 'done' : isDrawing ? 'active' : 'idle'}`}>
                {isDone && !isDrawing ? <CheckIcon /> : '2'}
              </div>
              <div className="mapq-step-line" style={{ opacity: isDone && !isDrawing ? 1 : 0.2 }} />
              <div className="mapq-step-body">
                <div className={`mapq-step-title ${isDrawing ? 'active' : ''}`}>
                  Trace your lawn
                </div>

                <div className="mapq-first-visit-promo" style={{ marginTop: 12, marginBottom: 0 }}>
                  <span className="mapq-first-visit-promo-badge">{FIRST_VISIT_DISCOUNT_PCT}% OFF</span>
                  <span className="mapq-first-visit-promo-text">Your first mow — applied automatically, no code needed</span>
                </div>

                {!isDrawing && !isDone && (
                  <div className="mapq-trace-demo-row" style={{ marginTop: 10 }}>
                    <svg className="mapq-trace-demo" width="52" height="40" viewBox="0 0 52 40" fill="none">
                      <rect x="1" y="1" width="50" height="38" rx="5" fill="rgba(255,255,255,.04)" stroke="rgba(255,255,255,.12)" strokeWidth="1"/>
                      <polygon
                        className="mapq-trace-demo-poly"
                        points="13,28 13,13 26,7 39,13 39,28"
                        pathLength={1}
                        fill="none" stroke="var(--green-bright)" strokeWidth="2" strokeLinejoin="round"
                      />
                      {[[13,28,0],[13,13,.3],[26,7,.6],[39,13,.9],[39,28,1.2]].map(([cx,cy,delay], i) => (
                        <circle key={i} className="mapq-trace-dot" style={{ animationDelay: `${delay}s` }} cx={cx} cy={cy} r="2.6" fill="var(--green-bright)"/>
                      ))}
                    </svg>
                    <p className="mapq-hint" style={{ margin: 0 }}>
                      Tap each corner of your grass on the map to trace it — not the dashed property line. Takes about 30 seconds.
                    </p>
                  </div>
                )}

                {isDrawing && !addonDrawTarget && (
                  <div style={{ marginTop: 14 }}>
                    {/* Live counter — the gamification hook */}
                    <div className="mapq-live-counter">
                      <div className="mapq-live-sqft">{liveSqFt > 0 ? liveSqFt.toLocaleString() : '—'}</div>
                      <div className="mapq-live-label">sq ft traced</div>
                      {ptCount > 0 && (
                        <div className="mapq-live-pts">{ptCount} point{ptCount !== 1 ? 's' : ''} placed</div>
                      )}
                    </div>

                    <p className="mapq-hint">
                      {ptCount < 3
                        ? 'Click around your lawn to place points'
                        : 'Keep going — hit Finish when done'}
                    </p>

                    {ptCount >= 3 ? (
                      <>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                          <button className="mapq-btn-primary" onClick={handleFinish} style={{ flex: 1 }}>
                            Finish ✓
                          </button>
                          <button className="mapq-btn-ghost" onClick={handleFinishAndAdd} style={{ flex: 1 }}>
                            + Add zone
                          </button>
                        </div>
                        <button className="mapq-link" onClick={cancelTrace} style={{ display: 'block', width: '100%', textAlign: 'center', fontSize: 12 }}>
                          {step === 'editing' ? 'Discard this zone' : 'Restart trace'}
                        </button>
                      </>
                    ) : (
                      <button className="mapq-btn-ghost" onClick={cancelTrace} style={{ width: '100%' }}>
                        {step === 'editing' ? 'Done adding zones' : 'Restart trace'}
                      </button>
                    )}
                  </div>
                )}

                {!isDrawing && isDone && lawnSqFt && (
                  <p className="mapq-step-done-text">
                    {lawnSqFt.toLocaleString()} sq ft traced
                    {staffQuote && <> · <button className="mapq-link" onClick={handleReset}>Start over</button></>}
                  </p>
                )}
              </div>
            </div>

            {/* Step 3 — Quote (customers only; staff price lives in the Price box) */}
            {!staffQuote && <div className="mapq-step mapq-step-last">
              <div className={`mapq-step-indicator ${isDone ? 'active' : 'idle'}`}>
                {isDone
                  ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                  : '3'}
              </div>
              <div className="mapq-step-body">
                <div ref={priceTitleRef} className={`mapq-step-title ${isDone ? 'active' : ''}`}>{compact ? 'Your price' : 'Your instant quote'}</div>

                {isDone && lawnSqFt && (
                  <div className="mapq-quote-card">

                    {/* Area summary (moves under the map preview when compact) */}
                    {!compact && <div className="mapq-sqft-row">
                      <div>
                        <div className="mapq-sqft-num">{animSqFt.toLocaleString()}</div>
                        <div className="mapq-sqft-label">sq ft of lawn</div>
                      </div>
                      <div className="mapq-sqft-badge">
                        <span className="mapq-pulse-dot" />
                        Traced
                      </div>
                    </div>}

                    {/* Add zone button */}
                    {step === 'done' && !compact && (
                      <button className="mapq-btn-ghost" onClick={enterEditMode} style={{ width: '100%', marginBottom: 16 }}>
                        + Add another area
                      </button>
                    )}

                    {/* Sections list (editing) */}
                    {step === 'editing' && sections.length > 0 && (
                      <div className="mapq-area-breakdown" style={{ marginBottom: 16 }}>
                        {sections.map(s => (
                          <div key={s.id} className="mapq-area-row">
                            <span className="mapq-area-swatch" style={{ background: '#52b788' }} />
                            <span className="mapq-area-highlight">{s.name}</span>
                            <span>{s.sqFt.toLocaleString()} sq ft</span>
                            <button className="mapq-link" onClick={() => deleteSection(s.id)} style={{ marginLeft: 6 }}>×</button>
                          </div>
                        ))}
                        {isDrawing && (
                          <div className="mapq-area-row">
                            <span className="mapq-area-swatch" style={{ background: '#74c9a0', opacity: 0.5 }} />
                            <span style={{ opacity: 0.5 }}>Drawing…</span>
                            <span className="mapq-sqft-anim">{liveSqFt > 0 ? liveSqFt.toLocaleString() : '—'}</span>
                          </div>
                        )}
                        {isDrawing && ptCount >= 3 && (
                          <button className="mapq-btn-primary" onClick={handleFinish} style={{ width: '100%', marginTop: 8 }}>
                            Add this zone ✓
                          </button>
                        )}
                        {/* "+ Add zone" opens a fresh empty zone — give a way out right here */}
                        {isDrawing && ptCount < 3 && (
                          <button className="mapq-btn-ghost" onClick={cancelTrace} style={{ width: '100%', marginTop: 8 }}>
                            Done adding zones
                          </button>
                        )}
                      </div>
                    )}

                    {!leadUnlocked ? (
                      <div className="mapq-lead-gate" ref={leadGateRef}>
                        <p className="mapq-lead-gate-text">Enter your phone to unlock your price — no commitment, no spam.</p>
                        <form onSubmit={handleLeadSubmit} className="mapq-lead-form">
                          <input
                            ref={leadPhoneRef}
                            className="mapq-input"
                            type="tel"
                            placeholder="(512) 555-0100"
                            value={leadPhone}
                            onChange={e => setLeadPhone(e.target.value)}
                            required
                            autoComplete="tel"
                            aria-label="Phone number"
                          />
                          <label className="mapq-consent-row">
                            <input
                              type="checkbox"
                              className="mapq-consent-checkbox"
                              checked={leadConsent}
                              onChange={e => setLeadConsent(e.target.checked)}
                              required
                            />
                            <span className="mapq-consent-text">{LEAD_CONSENT_TEXT} <a href="/privacy#sms" target="_blank" rel="noopener">Privacy Policy</a></span>
                          </label>
                          <button type="submit" className="mapq-btn-primary" disabled={leadStatus === 'submitting'}>
                            {leadStatus === 'submitting' ? <span className="mapq-spinner" /> : 'Unlock price →'}
                          </button>
                        </form>
                        {leadError && <p className="mapq-error">{leadError}</p>}
                        {/* Dev-only: test the price screen without sending a lead (stripped from production builds) */}
                        {process.env.NODE_ENV === 'development' && (
                          <button type="button" className="mapq-link mapq-dev-skip" onClick={() => setLeadUnlocked(true)}>
                            Skip — dev only, no lead sent
                          </button>
                        )}
                      </div>
                    ) : (
                      <>
                        {/* Headline is what they'll actually pay first — the discounted first visit */}
                        <div className="mapq-price-hero">
                          <div className="mapq-price-hero-top">
                            <span className="mapq-first-visit-promo-badge">{FIRST_VISIT_DISCOUNT_PCT}% OFF</span>
                            <span className="mapq-price-hero-label">Your first visit</span>
                          </div>
                          <div className="mapq-price-hero-row">
                            <span className="mapq-price-val">${firstVisitPrice}</span>
                            <span className="mapq-price-hero-was">${firstVisitFullPrice}</span>
                          </div>
                          <div className="mapq-price-hero-foot">
                            <span className="mapq-price-hero-then">
                              {freq === 'onetime'
                                ? 'One-time visit · no commitment'
                                : <>Then <strong>${ongoingPrice}</strong> per visit · fixed price</>}
                            </span>
                            <span className="mapq-eco-badge">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/>
                                <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>
                              </svg>
                              Zero emissions
                            </span>
                          </div>
                        </div>

                        <div className="mapq-price-rows">
                          <div className="mapq-price-row"><span>Base rate</span><span>${basePrice}</span></div>
                          {discount > 0 && (
                            <div className="mapq-price-row mapq-price-discount">
                              <span>{FREQ[freq].label} discount</span><span>–${Math.round(basePrice * discount / 100)}</span>
                            </div>
                          )}
                          {distanceFee > 0 && (
                            <div className="mapq-price-row" style={{ color: 'rgba(255,255,255,.6)' }}>
                              <span>{distanceLabel}</span><span>+${distanceFee}</span>
                            </div>
                          )}
                          {overgrowthFee > 0 && (
                            <div className="mapq-price-row mapq-price-overgrowth">
                              <span>{overgrowthLabel} <span className="mapq-price-once">(first visit only)</span></span>
                              <span>+${overgrowthFee}</span>
                            </div>
                          )}
                        </div>

                        <div className="mapq-includes-row">
                          {['Full mow', 'Crisp edging', 'Clipping blowdown', 'Complete cleanup'].map(item => (
                            <span key={item} className="mapq-includes-item">
                              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M2 8.5l4 4 8-8" />
                              </svg>
                              {item}
                            </span>
                          ))}
                        </div>

                        <div className="mapq-freq-label">How often?</div>
                        <div className="mapq-freq-row">
                          {(Object.entries(FREQ) as [Frequency, typeof FREQ[Frequency]][]).map(([key, f]) => (
                            <button key={key} className={`mapq-freq-btn ${freq === key ? 'selected' : ''}`} onClick={() => setFreq(key)}>
                              <span className="mapq-freq-name">{f.label}</span>
                              <span className="mapq-freq-sub">{f.sub}</span>
                              {f.discount > 0 && <span className="mapq-freq-discount">–{f.discount}%</span>}
                            </button>
                          ))}
                        </div>

                        {/* Season-aware overgrowth selector */}
                        <div className="mapq-season-tag">
                          <span className="mapq-season-dot" style={{ background: season.color }} />
                          <span>{season.name} — {season.note}</span>
                        </div>
                        <div className="mapq-freq-label">When was it last mowed?</div>
                        <div className="mapq-last-mow-grid">
                          {LAST_MOW_OPTS.map(opt => (
                            <button key={opt.key} className={`mapq-cond-btn ${lastMow === opt.key ? 'selected' : ''}`} onClick={() => setLastMow(opt.key)}>
                              <span className="mapq-cond-name">{opt.label}</span>
                              <span className="mapq-cond-sub">{opt.sub}</span>
                            </button>
                          ))}
                        </div>

                        <div className="mapq-addons" ref={addonsRef}>
                          <div className="mapq-addons-title">Also available — add to this visit</div>
                          <div className="mapq-addons-chips">
                            {(['fertilization', 'mulch', 'leafCleanup', 'maintenance', 'yardClearout'] as AddonKey[]).map(key => {
                              const meta = ADDON_META[key]
                              const included = { fertilization: fertIncluded, mulch: mulchIncluded, leafCleanup: leafIncluded, maintenance: maintenanceInterested, yardClearout: yardIncluded }[key]
                              return (
                                <button
                                  key={key}
                                  type="button"
                                  className={`mapq-addon-chip ${openAddon === key ? 'open' : ''} ${included ? 'included' : ''}`}
                                  onClick={() => setOpenAddon(openAddon === key ? null : key)}
                                >
                                  <span className="mapq-addon-chip-dot" style={{ background: meta.color }} />
                                  {meta.label}
                                  {included && <CheckIcon />}
                                </button>
                              )
                            })}
                          </div>

                          {openAddon === 'fertilization' && (
                            <div className="mapq-addon-panel">
                              <p className="mapq-addon-blurb">{ADDON_META.fertilization.blurb}</p>

                              {!fertAreaChoice ? (
                                <div className="mapq-addon-area-choice">
                                  <button type="button" className="mapq-btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setFertAreaChoice('same')}>
                                    Same lawn ({lawnSqFt?.toLocaleString()} sq ft)
                                  </button>
                                  <button type="button" className="mapq-btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={() => startAddonDraw('fertilization')}>
                                    Draw a different area
                                  </button>
                                </div>
                              ) : (
                                <>
                                  <div className="mapq-addon-area-summary">
                                    <span>{fertSqFt?.toLocaleString()} sq ft {fertAreaChoice === 'same' ? '(your lawn)' : '(custom area)'}</span>
                                    <button type="button" className="mapq-link" onClick={resetFertArea}>change</button>
                                  </div>

                                  <div className="mapq-addon-price-row">
                                    <span>Starting at</span>
                                    <span className="mapq-addon-price-val">${fertPrice}<span className="mapq-addon-price-sub"> /treatment</span></span>
                                  </div>
                                  <p className="mapq-addon-disclaimer">{FERT_DISCLAIMER}</p>

                                  <label className="mapq-addon-include-row">
                                    <input
                                      type="checkbox"
                                      className="mapq-consent-checkbox"
                                      checked={fertIncluded}
                                      onChange={e => { setFertIncluded(e.target.checked); if (e.target.checked && !staffQuote) trackAddonInterest('fertilization') }}
                                    />
                                    <span>Include fertilization interest with my booking request</span>
                                  </label>
                                </>
                              )}
                            </div>
                          )}

                          {openAddon === 'mulch' && (
                            <div className="mapq-addon-panel">
                              <p className="mapq-addon-blurb">{ADDON_META.mulch.blurb}</p>

                              {!mulchAreaChoice ? (
                                <div className="mapq-addon-area-choice">
                                  <button type="button" className="mapq-btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setMulchAreaChoice('same')}>
                                    Same lawn ({lawnSqFt?.toLocaleString()} sq ft)
                                  </button>
                                  <button type="button" className="mapq-btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={() => startAddonDraw('mulch')}>
                                    Draw your bed area
                                  </button>
                                </div>
                              ) : (
                                <>
                                  <div className="mapq-addon-area-summary">
                                    <span>{mulchSqFt?.toLocaleString()} sq ft {mulchAreaChoice === 'same' ? '(your lawn)' : '(drawn beds)'}</span>
                                    <button type="button" className="mapq-link" onClick={resetMulchArea}>change</button>
                                  </div>

                                  <div className="mapq-addon-depth-row">
                                    <span>Mulch depth</span>
                                    <div className="mapq-addon-depth-btns">
                                      {[2, 3, 4].map(d => (
                                        <button
                                          key={d}
                                          type="button"
                                          className={`mapq-cond-btn ${mulchDepthIn === d ? 'selected' : ''}`}
                                          style={{ padding: '6px 12px' }}
                                          onClick={() => setMulchDepthIn(d)}
                                        >
                                          <span className="mapq-cond-name">{d}&quot;</span>
                                        </button>
                                      ))}
                                    </div>
                                  </div>

                                  <div className="mapq-addon-price-row">
                                    <span>{mulchCuYd.toFixed(1)} cu yd installed</span>
                                    <span className="mapq-addon-price-val">${mulchPrice}</span>
                                  </div>
                                  <p className="mapq-addon-disclaimer">$150 minimum per visit. Final cu yd confirmed once we measure your beds on site.</p>

                                  <label className="mapq-addon-include-row">
                                    <input
                                      type="checkbox"
                                      className="mapq-consent-checkbox"
                                      checked={mulchIncluded}
                                      onChange={e => { setMulchIncluded(e.target.checked); if (e.target.checked && !staffQuote) trackAddonInterest('mulch') }}
                                    />
                                    <span>Include mulch interest with my booking request</span>
                                  </label>
                                </>
                              )}
                            </div>
                          )}

                          {openAddon === 'leafCleanup' && (
                            <div className="mapq-addon-panel">
                              <p className="mapq-addon-blurb">{ADDON_META.leafCleanup.blurb}</p>

                              <div className="mapq-addon-price-row">
                                <span>Your {lawnSqFt?.toLocaleString()} sq ft yard</span>
                                <span className="mapq-addon-price-val">${leafPrice}</span>
                              </div>

                              <label className="mapq-addon-include-row">
                                <input
                                  type="checkbox"
                                  className="mapq-consent-checkbox"
                                  checked={leafHaulAway}
                                  onChange={e => setLeafHaulAway(e.target.checked)}
                                />
                                <span>Haul the leaves away (+${LEAF_HAUL_AWAY_FEE}) — otherwise bagged at the curb</span>
                              </label>
                              <p className="mapq-addon-disclaimer">Fixed price, confirmed before we start. Very deep or wet leaf piles may cost more. Austin&apos;s live oaks drop in spring, so we do leaf cleanups year-round.</p>

                              <label className="mapq-addon-include-row">
                                <input
                                  type="checkbox"
                                  className="mapq-consent-checkbox"
                                  checked={leafIncluded}
                                  onChange={e => { setLeafIncluded(e.target.checked); if (e.target.checked && !staffQuote) trackAddonInterest('leafCleanup') }}
                                />
                                <span>Include leaf cleanup with my booking request</span>
                              </label>
                            </div>
                          )}

                          {openAddon === 'maintenance' && (
                            <div className="mapq-addon-panel">
                              <p className="mapq-addon-blurb">{ADDON_META.maintenance.blurb}</p>
                              <p className="mapq-addon-disclaimer">Visits from $75 — we&apos;ll confirm the scope once we see your beds.</p>
                              <label className="mapq-addon-include-row">
                                <input
                                  type="checkbox"
                                  className="mapq-consent-checkbox"
                                  checked={maintenanceInterested}
                                  onChange={e => { setMaintenanceInterested(e.target.checked); if (e.target.checked && !staffQuote) trackAddonInterest('maintenance') }}
                                />
                                <span>Include bed maintenance interest with my booking request</span>
                              </label>
                            </div>
                          )}

                          {openAddon === 'yardClearout' && (
                            <div className="mapq-addon-panel">
                              <p className="mapq-addon-blurb">{ADDON_META.yardClearout.blurb}</p>

                              {!yardAreaChoice ? (
                                <div className="mapq-addon-area-choice">
                                  <button type="button" className="mapq-btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setYardAreaChoice('same')}>
                                    Same lawn ({lawnSqFt?.toLocaleString()} sq ft)
                                  </button>
                                  <button type="button" className="mapq-btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={() => startAddonDraw('yardClearout')}>
                                    Draw the overgrown area
                                  </button>
                                </div>
                              ) : (
                                <>
                                  <div className="mapq-addon-area-summary">
                                    <span>{yardSqFt?.toLocaleString()} sq ft {yardAreaChoice === 'same' ? '(your lawn)' : '(drawn area)'}</span>
                                    <button type="button" className="mapq-link" onClick={resetYardArea}>change</button>
                                  </div>

                                  <div className="mapq-addon-depth-row">
                                    <span>Overgrowth level</span>
                                    <div className="mapq-addon-depth-btns">
                                      {CLEAROUT_LEVELS.map(lvl => (
                                        <button
                                          key={lvl.key}
                                          type="button"
                                          className={`mapq-cond-btn ${yardSeverity === lvl.key ? 'selected' : ''}`}
                                          style={{ padding: '6px 10px' }}
                                          onClick={() => setYardSeverity(lvl.key)}
                                          title={lvl.sub}
                                        >
                                          <span className="mapq-cond-name">{lvl.label}</span>
                                        </button>
                                      ))}
                                    </div>
                                  </div>

                                  <div className="mapq-addon-depth-row">
                                    <span>Anything extra back there?</span>
                                  </div>
                                  <div className="mapq-addon-hazard-row">
                                    {CLEAROUT_HAZARDS.map(hz => (
                                      <label key={hz.key} className={`mapq-addon-hazard-chip ${yardHazards.includes(hz.key) ? 'selected' : ''}`}>
                                        <input
                                          type="checkbox"
                                          checked={yardHazards.includes(hz.key)}
                                          onChange={() => toggleYardHazard(hz.key)}
                                        />
                                        {hz.label}
                                      </label>
                                    ))}
                                  </div>

                                  <div className="mapq-addon-price-row">
                                    <span>Starting at</span>
                                    <span className="mapq-addon-price-val">${yardPrice}</span>
                                  </div>
                                  {yardHasHazard && (
                                    <p className="mapq-addon-hazard-note">
                                      Includes +{CLEAROUT_HAZARD_SURCHARGE_PCT}% hazard surcharge (+${yardHazardFee}) for {yardHazards.map(k => CLEAROUT_HAZARDS.find(h => h.key === k)?.label).join(', ')}.
                                    </p>
                                  )}
                                  <p className="mapq-addon-disclaimer">${CLEAROUT_MINIMUM} minimum per visit. Final price confirmed once we see the area in person — overgrowth can hide surprises.</p>

                                  <label className="mapq-addon-include-row">
                                    <input
                                      type="checkbox"
                                      className="mapq-consent-checkbox"
                                      checked={yardIncluded}
                                      onChange={e => { setYardIncluded(e.target.checked); if (e.target.checked && !staffQuote) trackAddonInterest('yardClearout') }}
                                    />
                                    <span>Include yard clearout interest with my booking request</span>
                                  </label>
                                </>
                              )}
                            </div>
                          )}
                        </div>

                        <button className="mapq-cta" onClick={() => {
                          if (staffQuote) { void saveStaffDraft(false); return }
                          const map = mapRef.current
                          if (!map) { setShowBooking(true); return }
                          map.triggerRepaint()
                          map.once('render', () => {
                            const src = map.getCanvas()
                            const offscreen = document.createElement('canvas')
                            offscreen.width = src.width
                            offscreen.height = src.height
                            offscreen.getContext('2d')?.drawImage(src, 0, 0)
                            setMapScreenshot(offscreen.toDataURL('image/jpeg', 0.8))
                            setShowBooking(true)
                          })
                        }}>
                          {staffQuote ? 'Save draft estimate' : 'Book this visit'}
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                          </svg>
                        </button>
                        <p className="mapq-cta-note">No payment now · we&apos;ll email you a Stripe link after your first visit</p>
                        <p className="mapq-cta-note" style={{ marginTop: 6 }}>On your first visit, we&apos;ll measure the actual mowed area and adjust your price if needed.</p>
                      </>
                    )}

                    <button className="mapq-link mapq-reset" onClick={handleReset}>Start over</button>
                  </div>
                )}
              </div>
            </div>}

          </div>

          {/* ── Map ── */}
          <div className="mapq-map-wrap">
            <div className="mapq-map-border" style={{ position: 'relative' }}>
              {step === 'searching' && (
                <div className="mapq-flying-pill">
                  <span className="mapq-spinner" style={{ width: 14, height: 14, borderWidth: 2, borderTopColor: 'var(--green-bright)' }} />
                  Finding your property…
                </div>
              )}

              {isDrawing && !addonDrawTarget && (
                <div className="mapq-draw-pill">
                  <span className="mapq-pulse-dot" />
                  {ptCount < 3 ? 'Click to place points — trace your lawn' : `${ptCount} points · hit Finish to close`}
                </div>
              )}

              {isDrawing && addonDrawTarget && (
                <div className="mapq-draw-pill">
                  <span className="mapq-pulse-dot" />
                  {ptCount < 3 ? `Click to trace your ${ADDON_META[addonDrawTarget].label.toLowerCase()} area` : `${ptCount} points · hit Finish to close`}
                </div>
              )}

              {step === 'idle' && (
                <div className="mapq-map-placeholder">
                  <TraceDemo />
                  <div className="mapq-demo-copy">
                  <p className="mapq-map-placeholder-title">Trace just the grass — about 30 seconds</p>
                  <p className="mapq-map-placeholder-sub">The dashed line is your property line — it&apos;s only a guide. Tap the corners of the grass we&apos;ll mow.</p>
                  </div>
                </div>
              )}

              <div ref={mapDivRef} className="mapq-map" />
              <canvas ref={previewCanvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 2 }} />
            </div>
            {/* Credit must match the imagery actually shown (Mapbox's terms require theirs) */}
            <p className="mapq-attribution">
              {MAPBOX_TOKEN ? (
                <>
                  <a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noopener noreferrer">© Mapbox</a>{' '}
                  <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap</a>{' '}
                  <a href="https://www.mapbox.com/map-feedback/" target="_blank" rel="noopener noreferrer">Improve this map</a>{' '}
                  © Maxar · Labels © Esri
                </>
              ) : <>Satellite imagery © Esri · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">Address data © OpenStreetMap</a></>}
            </p>

            {compact && lawnSqFt && (
              <div className="mapq-map-summary">
                <div className="mapq-map-summary-addr">{address}</div>
                <div className="mapq-map-summary-sqft">
                  <span className="mapq-pulse-dot" />
                  {lawnSqFt.toLocaleString()} sq ft of lawn traced
                </div>
                <div className="mapq-map-summary-actions">
                  <button className="mapq-btn-ghost" onClick={enterEditMode}>+ Add another area</button>
                  <button className="mapq-link" onClick={handleReset}>New address</button>
                </div>
              </div>
            )}

            {isDrawing && addonDrawTarget && (
              <div className="mapq-addon-draw-bar">
                <div className="mapq-addon-draw-info">
                  <span className="mapq-pulse-dot" />
                  Tracing your {ADDON_META[addonDrawTarget].label.toLowerCase()} area — {liveSqFt > 0 ? liveSqFt.toLocaleString() : 0} sq ft
                </div>
                <div className="mapq-addon-draw-btns">
                  {ptCount >= 3 && (
                    <button className="mapq-btn-primary" onClick={handleFinish}>Finish area ✓</button>
                  )}
                  <button className="mapq-btn-ghost" onClick={cancelAddonDraw}>Cancel</button>
                </div>
              </div>
            )}

            {(step === 'drawing' || step === 'editing') && !showManualSqFt && (
              <button
                onClick={() => setShowManualSqFt(true)}
                style={{ marginTop: 10, width: '100%', display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,255,255,0.06)', border: '1px dashed rgba(255,255,255,0.18)', borderRadius: 10, padding: '10px 14px', cursor: 'pointer', textAlign: 'left' }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(149,219,184,0.8)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M2 12h20M2 12l4-4M2 12l4 4M22 12l-4-4M22 12l-4 4"/>
                  <line x1="8" y1="7" x2="8" y2="17"/><line x1="12" y1="5" x2="12" y2="19"/><line x1="16" y1="7" x2="16" y2="17"/>
                </svg>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.85)' }}>Can&apos;t see your lawn clearly?</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>Enter sq ft manually to get your quote</div>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 'auto', flexShrink: 0 }}>
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </button>
            )}
            {showManualSqFt && (
              <div style={{ marginTop: 10, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>Enter your approximate lawn area</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="number"
                    placeholder="e.g. 3500"
                    value={manualSqFtInput}
                    onChange={e => setManualSqFtInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleManualSqFt()}
                    style={{ flex: 1, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '8px 12px', color: '#fff', fontSize: 14, outline: 'none' }}
                    autoFocus
                  />
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>sq ft</span>
                  <button className="mapq-btn-primary" onClick={handleManualSqFt} style={{ whiteSpace: 'nowrap', padding: '8px 14px' }}>
                    Get quote →
                  </button>
                </div>
                <button className="mapq-link" onClick={() => { setShowManualSqFt(false); setManualSqFtInput('') }} style={{ fontSize: 11, marginTop: 8, display: 'block' }}>
                  ← Back to tracing
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Booking modal ── */}
      {showBooking && (
        <div className="booking-overlay" onClick={e => { if (e.target === e.currentTarget) closeBooking() }}>
          <div className="booking-modal">

            {bookingStatus === 'success' ? (
              <div className="booking-success">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--green-bright)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><polyline points="20 6 9 17 4 12"/>
                </svg>
                <h3>Request locked in.</h3>
                <p>We&apos;ll confirm your date shortly. After your first visit we&apos;ll email you a Stripe payment link — no payment needed now.</p>
                <button className="booking-success-btn" onClick={closeBooking}>Done</button>
              </div>
            ) : (
              <>
                <button className="booking-close" onClick={closeBooking} aria-label="Close">×</button>
                <h3 className="booking-title">Confirm your booking</h3>

                <div className="booking-summary">
                  <div className="booking-summary-addr">{address}</div>
                  <div className="booking-summary-stats">
                    <span>{lawnSqFt?.toLocaleString()} sq ft</span>
                    <span className="booking-dot">·</span>
                    <span>{FREQ[freq].label}</span>
                    <span className="booking-dot">·</span>
                    <span>${ongoingPrice}/visit</span>
                    <span className="booking-dot">·</span>
                    <span>First visit ${firstVisitPrice} ({FIRST_VISIT_DISCOUNT_PCT}% off)</span>
                  </div>
                  {addonInterest && (
                    <div className="booking-summary-addons">
                      {fertIncluded && <span>+ Fertilization interest (${fertPrice} starting)</span>}
                      {mulchIncluded && <span>+ Mulch interest (${mulchPrice})</span>}
                      {leafIncluded && <span>+ Leaf cleanup (${leafPrice}{leafHaulAway ? ', hauled away' : ''})</span>}
                      {maintenanceInterested && <span>+ Bed maintenance interest</span>}
                      {yardIncluded && <span>+ Yard clearout interest (${yardPrice} starting)</span>}
                    </div>
                  )}
                </div>

                <form onSubmit={handleBookingSubmit}>
                  <div className="booking-fields">
                    <div className="booking-field">
                      <label htmlFor="booking-name">Name</label>
                      <input id="booking-name" type="text" placeholder="Jane Smith" required autoComplete="name" value={bookingName} onChange={e => setBookingName(e.target.value)} />
                    </div>
                    <div className="booking-field">
                      <label htmlFor="booking-phone">Phone</label>
                      <input id="booking-phone" type="tel" placeholder="(512) 555-0100" required autoComplete="tel" value={bookingPhone} onChange={e => setBookingPhone(e.target.value)} />
                    </div>
                    <div className="booking-field">
                      <label htmlFor="booking-email">Email</label>
                      <input id="booking-email" type="email" placeholder="jane@example.com" required autoComplete="email" value={bookingEmail} onChange={e => setBookingEmail(e.target.value)} />
                    </div>
                    <div className="booking-field">
                      <label>Preferred first visit <span className="booking-optional">optional</span></label>
                      <div className="booking-daypicker-wrap">
                        <DayPicker
                          mode="single"
                          selected={bookingDate}
                          onSelect={setBookingDate}
                          disabled={{ before: (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(0,0,0,0); return d })() }}
                          startMonth={(() => { const d = new Date(); d.setDate(d.getDate() + 1); return d })()}
                          classNames={{ root: 'booking-daypicker' }}
                        />
                      </div>
                    </div>
                    <div className="booking-field">
                      <label>Arrival window <span className="booking-optional">optional</span></label>
                      <div className="admin-time-window-row">
                        {(['Morning', 'Afternoon', ''] as const).map(opt => (
                          <button
                            key={opt || 'none'}
                            type="button"
                            className={`admin-time-window-btn ${bookingTimeWindow === opt ? 'selected' : ''}`}
                            onClick={() => setBookingTimeWindow(opt)}
                          >
                            {opt || 'No preference'}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="booking-field">
                      <label htmlFor="booking-notes">Notes <span className="booking-optional">optional</span></label>
                      <textarea
                        id="booking-notes"
                        placeholder="Gate code, dog in yard, anything we should know…"
                        rows={3}
                        value={bookingNotes}
                        onChange={e => setBookingNotes(e.target.value)}
                      />
                    </div>
                  </div>

                  {bookingError && <p className="booking-error" role="alert">{bookingError}</p>}

                  <button type="submit" className="booking-submit" disabled={bookingStatus === 'submitting'}>
                    {bookingStatus === 'submitting'
                      ? <><span className="mapq-spinner" style={{ borderTopColor: '#fff' }} /> Sending…</>
                      : 'Request this visit →'}
                  </button>
                </form>
                <p className="booking-note">No payment now · we&apos;ll email you a Stripe link after your first visit</p>
              </>
            )}
          </div>
        </div>
      )}

      <p className="mapq-text-fallback">
        Prefer to talk to a person?{' '}
        <a href="tel:+16823528260">Call (682) 352-8260</a>{' '}
        or{' '}
        <a href="mailto:hello@quietgreen.co?subject=Quote%20Request&body=Hi%2C%20I%27d%20like%20a%20quote%20for%20my%20lawn%20at%20">
          email us your address
        </a>{' '}
        and we'll send you a price.
      </p>

      {isDrawing && ptCount >= 3 && !addonDrawTarget && (
        <div className="mapq-mobile-draw-bar">
          <button className="mapq-btn-primary" onClick={handleFinish} style={{ flex: 1 }}>
            Finish ✓
          </button>
          <button className="mapq-btn-ghost" onClick={handleFinishAndAdd} style={{ flex: 1 }}>
            + Add zone
          </button>
        </div>
      )}
      {isDrawing && ptCount < 3 && step === 'editing' && !addonDrawTarget && (
        <div className="mapq-mobile-draw-bar">
          <button className="mapq-btn-ghost" onClick={cancelTrace} style={{ flex: 1 }}>
            Done adding zones
          </button>
        </div>
      )}
    </section>
  )
}
