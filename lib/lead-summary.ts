/**
 * The one place that turns a lead into chips, a price line and alert wording (PLAN.md 4.1d,
 * 4.1e, 7.3, 7.6; quality bar 6.2 "Correct"). The board card, lead page and staff texts all
 * call these functions, so they cannot disagree. Pure: no database, no env.
 */
import { CALL_OUTCOME, CLOSED_REASON_LABEL, COLUMN_LABEL, FREQUENCY_LABEL, QUOTED_REASON_LABEL, isCallOutcome,
  isClosedReason, isColumn, isQuotedReason, normalizeFrequency, type BoardColumn, type Frequency } from './lead-board'
import { leadSource, readableAnswers, serviceLabels } from './lead-labels'
import { FIRST_VISIT_DISCOUNT_PCT, firstVisitPrice, planDiscountPct, quoteOffer } from './quote-offer'
import { quoteTotalCents, type QuoteDraft } from './quote-draft'

export type SummaryLead = {
  id: string; name?: string | null; phone?: string | null; email?: string | null; address?: string | null; sq_ft?: number | null
  created_at: string; source?: string | null; services?: unknown; frequency?: string | null; timing?: string | null
  answers?: unknown; attribution?: unknown
  board_column?: string | null; call_attempts?: number | null; quoted_reason?: string | null; closed_reason?: string | null
  check_back_on?: string | null; first_visit_on?: string | null; customer_canceled_at?: string | null
  phone_price_cents?: number | null; phone_frequency?: string | null; phone_price_at?: string | null
  website_price_cents?: number | null; website_first_visit_cents?: number | null; website_frequency?: string | null; website_price_at?: string | null
  quote_status?: string | null; quote_draft?: unknown; quote_confirmed_at?: string | null; quote_emailed_at?: string | null
  accepted_quote_snapshot?: unknown; quote_accepted_at?: string | null
  lawn_tracing?: unknown; short_code?: string | null
  taken_by?: string | null; taken_at?: string | null; not_taken_at?: string | null; needs_call_log_at?: string | null
} & Record<string, unknown>

/** Bookings for this lead. Generated plan visits are ignored for the request (see requestBookings). */
export type SummaryBooking = {
  status?: string | null; created_at?: string | null; preferred_date?: string | null; preferred_time?: string | null
  confirmed_date?: string | null; frequency?: string | null; price_per_visit?: number | null; first_visit_price?: number | null
  overgrowth_fee?: number | null; customer_notes?: string | null; addon_interest?: unknown; occurrence_on?: string | null; agreement_id?: string | null
  /** Set on bookings priced by phone (Log call Booked). */
  manual_quote?: boolean | null
}

export type PriceSource = 'website' | 'phone' | 'emailed'
export const PRICE_SOURCE_LABEL: Record<PriceSource, string> = { website: 'Website price', phone: 'Phone price', emailed: 'Emailed' }
export type BookingState = 'not_booked' | 'requested' | 'booked' | 'canceled'
export const BOOKING_LABEL: Record<BookingState, string> = { not_booked: 'Not booked', requested: 'Requested', booked: 'Booked', canceled: 'Canceled' }

/** Chip tones are fixed per meaning so colors never vary by screen. */
export type ChipTone = 'accent' | 'warn' | 'ok' | 'bad' | 'neutral'
export type Chip = { key: string; label: string; tone: ChipTone }

export type Price = {
  source: PriceSource; at: string | null
  cents: number; frequency: Frequency | null; recurring: boolean
  firstVisitCents: number | null; firstVisitPct: number | null; planDiscountPct: number | null
}

export type LeadSummary = {
  column: BoardColumn; columnLabel: string
  booking: BookingState; bookingLabel: string
  price: Price | null
  chips: Chip[]
  /** Card line 1 (PLAN.md 3.2): booked? quoted? how much and from where; else what they want. */
  headline: string
  headlineTone: ChipTone
  /** Card line 2: request · place · source. */
  meta: string
  /** Board card, structured (Caelan, 28 Oct: name, price, one status chip, age; the rest on the lead page). */
  card: { amount: string | null; unit: string | null; status: Chip | null; detail: string }
  name: string; phoneDisplay: string; city: string | null
  services: string[]; frequencyLabel: string | null
  wanted: { date: string | null; window: string | null; label: string | null }
  source: { channel: string; detail: string | null; conviflo: boolean }
  tracedSqFt: number | null
  notes: string | null
  answers: { label: string; value: string }[]
  link: string | null
}

const TZ = 'America/Chicago'
const asObject = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const time = (value: string | null | undefined) => value ? Date.parse(value) || 0 : 0

/** "$45", "$45.50". Numbers big, units small: callers add "/ visit" themselves. */
export function money(cents: number): string {
  const whole = Math.abs(cents) % 100 === 0
  return `${cents < 0 ? '−' : ''}$${(Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`
}

/** (512) 555-0142 for US numbers; anything else as stored. */
export function phoneDisplay(phone: string | null | undefined): string {
  if (!phone) return ''
  const digits = phone.replace(/\D/g, '')
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  if (national.length !== 10 || /[a-z]/i.test(phone) || (phone.trim().startsWith('+') && !phone.trim().startsWith('+1'))) return phone
  return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`
}

/** "+15125550142" from what a customer typed; null when it can't be dialed (E8). */
export function dialable(phone: string | null | undefined): string | null {
  const raw = (phone ?? '').trim()
  if (!raw || /[a-z]/i.test(raw)) return null
  const digits = raw.replace(/\D/g, '')
  if (raw.startsWith('+')) return /^\+[1-9]\d{9,14}$/.test(`+${digits}`) ? `+${digits}` : null
  if (digits.length === 10 && /^[2-9]/.test(digits)) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1') && /^[2-9]/.test(digits[1])) return `+${digits}`
  return null
}

/** "Oct 28", or "Tue Nov 4" with the weekday. Date-only values are calendar days, not instants. */
export function dayLabel(value: string | null | undefined, weekday = false): string | null {
  if (!value) return null
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const date = new Date(dateOnly ? `${value}T12:00:00Z` : value)
  if (!Number.isFinite(date.getTime())) return null
  return date.toLocaleDateString('en-US', { timeZone: dateOnly ? 'UTC' : TZ, month: 'short', day: 'numeric', ...(weekday ? { weekday: 'short' } : {}) }).replace(',', '')
}

/** "2:15p" today, else "Oct 28". */
export function clockLabel(value: string, now = Date.now()): string {
  const date = new Date(value)
  const day = (d: Date) => d.toLocaleDateString('en-US', { timeZone: TZ })
  if (day(date) !== day(new Date(now))) return dayLabel(value) ?? ''
  return date.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).replace(/\s?([AP])M$/, (_, x: string) => x.toLowerCase())
}

/** "12m", "2h", "3d". */
export function ago(value: string, now = Date.now()): string {
  const mins = Math.floor(Math.max(0, now - Date.parse(value)) / 60000)
  if (mins < 60) return `${mins}m`
  if (mins < 1440) return `${Math.floor(mins / 60)}h`
  return `${Math.floor(mins / 1440)}d`
}

/** Street plus city, without state/ZIP: "1234 Oak St, Round Rock". */
export function shortAddress(address: string | null | undefined): string | null {
  const parts = (address ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (!parts.length) return null
  const kept = parts.filter((part, i) => i === 0 || !/^(tx|texas)?\s*\d{5}(-\d{4})?$|^(tx|texas|usa|united states)$/i.test(part))
  return kept.slice(0, Math.min(kept.length, 2 + (/^(apt|unit|ste|suite|#)/i.test(kept[1] ?? '') ? 1 : 0))).join(', ')
}
export function cityOf(address: string | null | undefined): string | null {
  const parts = (shortAddress(address) ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return parts.length > 1 ? parts[parts.length - 1] : null
}

const firstVisitCents = (cents: number, freq: Frequency) => cents % 100 === 0
  ? firstVisitPrice(cents / 100, freq) * 100 : Math.round(cents * (100 - FIRST_VISIT_DISCOUNT_PCT) / 100)

function makePrice(source: PriceSource, at: string | null, cents: number, freq: Frequency | null, firstCents?: number | null): Price {
  const recurring = !!freq && freq !== 'onetime'
  const first = firstCents ?? (freq ? firstVisitCents(cents, freq) : null)
  // Show the policy 30% when the first-visit price is the policy price (whole-dollar rounding aside).
  const pct = recurring && first != null && first < cents
    ? Math.abs(first - firstVisitCents(cents, freq!)) <= 100 ? FIRST_VISIT_DISCOUNT_PCT : Math.round((1 - first / cents) * 100) : null
  return { source, at, cents, frequency: freq, recurring, firstVisitCents: recurring && first != null && first !== cents ? first : null,
    firstVisitPct: pct, planDiscountPct: freq && planDiscountPct(freq) ? planDiscountPct(freq) : null }
}

function draftPrice(draft: unknown, source: PriceSource, at: string | null): Price | null {
  const value = asObject(draft) as QuoteDraft | null
  if (!value || !Array.isArray(value.sections)) return null
  const cents = quoteTotalCents(value)
  if (!(cents > 0)) return null
  const offer = quoteOffer(value)
  if (!offer.recurring) return makePrice(source, at, cents, 'onetime', cents)
  const option = offer.options.find(o => o.freq === offer.quoted)
  return makePrice(source, at, cents, value.freq, option && cents % 100 === 0 ? option.firstVisit * 100 : null)
}

/** The bookings that describe this lead's own request (not later generated plan visits). */
export function requestBookings(bookings: SummaryBooking[] = []) {
  // Starting a plan gives the lead's own first visit an agreement and occurrence date too; it is
  // the plan's earliest booking. Every later visit of the plan is generated.
  const firstOfPlan = new Map<string, SummaryBooking>()
  for (const b of bookings) {
    const first = b.agreement_id ? firstOfPlan.get(b.agreement_id) : undefined
    if (b.agreement_id && (!first || time(b.created_at) < time(first.created_at))) firstOfPlan.set(b.agreement_id, b)
  }
  return bookings.filter(b => b.agreement_id ? firstOfPlan.get(b.agreement_id) === b : !b.occurrence_on)
    .sort((a, b) => time(b.created_at) - time(a.created_at))
}

/** Where a booking's price came from: phone when staff priced it on a call, emailed when booked after an emailed quote, else the website. */
function bookingSource(lead: SummaryLead, booking: SummaryBooking): PriceSource {
  if (booking.manual_quote) return 'phone'
  return lead.quote_emailed_at && time(lead.quote_emailed_at) <= time(booking.created_at) ? 'emailed' : 'website'
}

type PriceCandidate = Omit<PriceRow, 'value'> & { headline: boolean }

/** Every known price. Unsaved drafts are listed but never the headline. */
function priceRows(lead: SummaryLead, bookings: SummaryBooking[]): PriceCandidate[] {
  const rows: PriceCandidate[] = []
  if (lead.website_price_cents) {
    rows.push({ key: 'website', label: 'Website', headline: true, price: makePrice('website', lead.website_price_at ?? lead.created_at, lead.website_price_cents,
      normalizeFrequency(lead.website_frequency), lead.website_first_visit_cents) })
  }
  if (lead.phone_price_cents) {
    rows.push({ key: 'phone', label: 'Phone', headline: true, price: makePrice('phone', lead.phone_price_at ?? null, lead.phone_price_cents, normalizeFrequency(lead.phone_frequency)) })
  }
  const quoteSource = lead.quote_emailed_at ? 'emailed' : 'phone'
  const accepted = lead.quote_status === 'accepted' && lead.accepted_quote_snapshot
    ? draftPrice(lead.accepted_quote_snapshot, quoteSource, lead.quote_accepted_at ?? null) : null
  if (accepted) rows.push({ key: 'accepted', label: 'Accepted', headline: true, price: accepted })
  else if (lead.quote_status !== 'accepted' && lead.quote_draft) {
    const saved = typeof lead.quote_saved_at === 'string' ? lead.quote_saved_at : null
    const draft = draftPrice(lead.quote_draft, quoteSource, lead.quote_emailed_at ?? lead.quote_confirmed_at ?? saved)
    if (draft) rows.push({ key: 'quote', label: lead.quote_emailed_at ? 'Emailed quote' : lead.quote_confirmed_at ? 'Saved quote' : 'Draft quote',
      headline: !!(lead.quote_emailed_at || lead.quote_confirmed_at), price: draft })
  }
  const booking = requestBookings(bookings).find(b => b.status !== 'canceled' && (b.price_per_visit ?? 0) > 0)
  if (booking) {
    const source = bookingSource(lead, booking)
    rows.push({ key: 'booking', label: source === 'phone' ? 'Booked by phone' : 'Online booking', headline: true,
      price: makePrice(source, (source === 'phone' ? lead.phone_price_at : null) ?? booking.created_at ?? null, booking.price_per_visit! * 100, normalizeFrequency(booking.frequency) ?? 'onetime',
        booking.first_visit_price != null ? booking.first_visit_price * 100 : null) })
  }
  return rows
}

/** Latest price we know they saw or heard, with where it came from (PLAN.md 3.2, 4.1e). */
export function leadPrice(lead: SummaryLead, bookings: SummaryBooking[] = []): Price | null {
  return priceRows(lead, bookings).filter(row => row.headline).map(row => row.price).sort((a, b) => time(b.at) - time(a.at))[0] ?? null
}

export function bookingState(lead: SummaryLead, bookings: SummaryBooking[] = []): BookingState {
  if (lead.customer_canceled_at) return 'canceled'
  const own = requestBookings(bookings)
  if (lead.board_column === 'customer' || bookings.some(b => ['confirmed', 'completed'].includes(b.status ?? ''))) return 'booked'
  if (own.some(b => b.status === 'pending') || lead.board_column === 'booking_request') return 'requested'
  return 'not_booked'
}

/** "$45/visit · 1st $32"; one-time jobs read "$120 total". */
export function priceShort(price: Price | null): string {
  if (!price) return 'No price'
  if (!price.recurring) return `${money(price.cents)} total`
  return `${money(price.cents)}/visit${price.firstVisitCents != null ? ` · 1st ${money(price.firstVisitCents)}` : ''}`
}

const traced = (lead: SummaryLead): number | null => {
  const shapes = Array.isArray(lead.lawn_tracing) ? lead.lawn_tracing : []
  const sum = shapes.reduce((total: number, shape) => total + (Number(asObject(shape)?.sqFt) || 0), 0)
  return sum > 0 ? Math.round(sum) : lead.sq_ft && lead.sq_ft > 0 ? lead.sq_ft : null
}

function wanted(lead: SummaryLead, booking: SummaryBooking | undefined) {
  const date = booking?.preferred_date ?? (/^\d{4}-\d{2}-\d{2}$/.test(lead.timing ?? '') ? lead.timing! : null)
  const window = booking?.preferred_time && !/^any/i.test(booking.preferred_time) ? booking.preferred_time.toLowerCase() : null
  const text = date ? [dayLabel(date, true), window].filter(Boolean).join(' · ') : lead.timing || null
  return { date, window, label: text }
}

const nameOf = (lead: SummaryLead) => lead.name?.trim() || phoneDisplay(lead.phone) || 'No name'

export function summarizeLead(lead: SummaryLead, bookings: SummaryBooking[] = [], options: { baseUrl?: string; existingCustomer?: boolean; addressChanged?: boolean; now?: number } = {}): LeadSummary {
  const column: BoardColumn = isColumn(lead.board_column) ? lead.board_column : 'new'
  const booking = bookingState(lead, bookings)
  const price = leadPrice(lead, bookings)
  const own = requestBookings(bookings)
  const live = own.find(b => b.status !== 'canceled') ?? own[0]
  const services = serviceLabels(lead.services)
  const freq = price?.frequency ?? normalizeFrequency(live?.frequency) ?? normalizeFrequency(lead.frequency)
  const want = wanted(lead, live)
  const source = leadSource(lead)
  const answers = asObject(lead.answers) ?? {}
  const notes = [live?.customer_notes, answers.notes, answers.project_description].find((v): v is string => typeof v === 'string' && !!v.trim())?.trim() ?? null
  const city = cityOf(lead.address)

  const due = !!lead.check_back_on && lead.check_back_on <= new Date(options.now ?? Date.now()).toLocaleDateString('en-CA', { timeZone: TZ })
  const chips: Chip[] = [
    columnChip(column),
    { key: 'booking', label: BOOKING_LABEL[booking], tone: booking === 'booked' ? 'ok' : booking === 'canceled' ? 'bad' : booking === 'requested' ? 'warn' : 'neutral' },
  ]
  if (price) chips.push({ key: 'price', label: PRICE_SOURCE_LABEL[price.source], tone: 'neutral' })
  if (column === 'quoted' && isQuotedReason(lead.quoted_reason)) chips.push({ key: 'reason', label: QUOTED_REASON_LABEL[lead.quoted_reason], tone: 'warn' })
  if (column === 'closed' && isClosedReason(lead.closed_reason)) chips.push({ key: 'reason', label: CLOSED_REASON_LABEL[lead.closed_reason], tone: 'neutral' })
  if (lead.check_back_on && ['quoted', 'booking_request', 'in_talks'].includes(column)) {
    chips.push({ key: 'check_back', label: `Check back ${dayLabel(lead.check_back_on)}`, tone: due ? 'bad' : 'neutral' })
  }
  if (lead.taken_by) chips.push({ key: 'taken', label: `Taken by ${lead.taken_by}`, tone: 'neutral' })
  else if (lead.not_taken_at && column === 'new') chips.push({ key: 'not_taken', label: 'Missed alert', tone: 'bad' })
  if (lead.needs_call_log_at) chips.push({ key: 'log_call', label: 'Log this call', tone: 'warn' })
  if (options.existingCustomer) chips.push({ key: 'existing', label: 'Existing customer', tone: 'ok' })
  if (answers.address_missing === true || !lead.address) chips.push({ key: 'address', label: 'No address', tone: 'warn' })
  else if (answers.address_needs_review === true) chips.push({ key: 'address', label: 'Check address', tone: 'warn' })
  if (options.addressChanged) chips.push({ key: 'address_changed', label: 'Address changed', tone: 'warn' })
  if (answers.service_unmapped === true) chips.push({ key: 'service_unclear', label: 'Service unclear', tone: 'warn' })

  const want1 = services.length ? services.join(', ').toLowerCase() : null
  let headline: string, headlineTone: ChipTone = 'neutral'
  const attempts = lead.call_attempts ?? 0
  if (column === 'booking_request' && live) {
    headline = ['Wants', want.label ?? 'date TBD', price ? priceShort(price) : null].filter(Boolean).join(' · ').replace('Wants ·', 'Wants')
    headlineTone = 'warn'
  } else if (column === 'customer') {
    const first = live?.confirmed_date ?? lead.first_visit_on ?? live?.preferred_date ?? null
    headline = booking === 'canceled' ? `Canceled ${dayLabel(lead.customer_canceled_at) ?? ''}`.trim()
      : first ? `First visit ${dayLabel(first, true)}` : 'Booked'
    headlineTone = booking === 'canceled' ? 'bad' : 'ok'
  } else if (column === 'closed') {
    headline = lead.closed_reason === 'bad_number' ? 'Bad number' : `No · ${isClosedReason(lead.closed_reason) ? CLOSED_REASON_LABEL[lead.closed_reason].toLowerCase() : '—'}`
  } else if (column === 'quoted' && isQuotedReason(lead.quoted_reason)) {
    headline = ['Not now', QUOTED_REASON_LABEL[lead.quoted_reason].toLowerCase(), dayLabel(lead.check_back_on)].filter(Boolean).join(' · ')
    headlineTone = 'warn'
  } else if (column === 'in_talks' && attempts > 0 && !price) {
    headline = `No answer ×${attempts}`
  } else if (price) {
    const from = price.source === 'website' ? `website${booking === 'not_booked' ? ' · didn\'t book' : ''}`
      : price.source === 'phone' ? `told by phone ${dayLabel(price.at) ?? ''}`.trim() : `emailed ${dayLabel(price.at) ?? ''}`.trim()
    headline = `${priceShort(price)} · ${from}`
    if (column === 'in_talks' && attempts > 0) headline += ` · no answer ×${attempts}`
    headlineTone = price.source === 'website' && booking === 'not_booked' ? 'warn' : 'neutral'
  } else {
    headline = `No price${want1 ? ` · wants ${want1}` : ''}`
  }
  const status = (label: string, tone: ChipTone): Chip => ({ key: 'status', label, tone })
  // The card's one chip: the headline's status words without the price, which the card shows on its own.
  const cardStatus = column === 'booking_request' && live ? status(`Wants ${want.label ?? 'date TBD'}`, 'warn')
    : column === 'customer' || column === 'closed' ? status(column === 'closed' && lead.closed_reason !== 'bad_number' && isClosedReason(lead.closed_reason)
      ? CLOSED_REASON_LABEL[lead.closed_reason] : headline, column === 'closed' ? 'neutral' : headlineTone)
    : column === 'quoted' && isQuotedReason(lead.quoted_reason) ? status([QUOTED_REASON_LABEL[lead.quoted_reason], dayLabel(lead.check_back_on)].filter(Boolean).join(' · '), due ? 'bad' : 'warn')
    : column === 'new' && lead.not_taken_at && !lead.taken_by ? status('Missed alert', 'bad')
    : column === 'in_talks' && attempts > 0 ? status(`No answer ×${attempts}`, 'neutral')
    : price?.source === 'website' && booking === 'not_booked' ? status('Didn\'t book', 'warn')
    : price ? status(PRICE_SOURCE_LABEL[price.source], 'neutral')
    : null
  const card = {
    amount: price ? money(price.cents) : null,
    unit: price ? `${price.recurring ? '/visit' : 'total'} · ${price.source === 'website' ? 'website' : price.source === 'phone' ? 'phone' : 'emailed'}` : null,
    status: cardStatus,
    detail: [services.join(', ') || null, city ?? (lead.address ? null : 'No address')].filter(Boolean).join(' · '),
  }
  const sourceShort = source.detail && source.channel === 'Facebook ad' ? `${source.channel} · ${source.detail.split(' · ')[0]}` : source.channel
  const meta = [services[0] ?? null, city ?? (lead.address ? null : 'no address yet'), source.conviflo && source.channel !== 'ConviFlo form' ? 'ConviFlo' : null, sourceShort]
    .filter(Boolean).join(' · ')

  return {
    column, columnLabel: COLUMN_LABEL[column], booking, bookingLabel: BOOKING_LABEL[booking], price, chips, headline, headlineTone, meta, card,
    name: nameOf(lead), phoneDisplay: phoneDisplay(lead.phone), city, services,
    frequencyLabel: freq ? FREQUENCY_LABEL[freq] : null, wanted: want, source, tracedSqFt: traced(lead), notes,
    answers: readableAnswers(lead.answers), link: options.baseUrl && lead.short_code ? leadLink(options.baseUrl, lead.short_code) : null,
  }
}

/** "quietgreen.co/l/AB12CD": short enough for a text, and phones make it tappable. */
export function leadLink(baseUrl: string, code: string): string {
  const url = new URL(baseUrl)
  const shown = url.protocol === 'https:' ? url.host : url.origin
  return `${shown}/l/${encodeURIComponent(code)}`
}

export const isTestLead = (lead: Pick<SummaryLead, 'name'>) => /^\s*test\b/i.test(lead.name ?? '')

const clean = (value: string) => value.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim()
const fit = (lines: (string | null | false | undefined)[], limit: number, keepLast = 1) => {
  const kept = lines.filter((line): line is string => !!line).map(clean)
  const tail = kept.splice(kept.length - keepLast, keepLast)
  while (kept.length > 2 && [...kept, ...tail].join('\n').length > limit) kept.splice(kept.length - 1, 1)
  return [...kept, ...tail].join('\n')
}
const sqFt = (n: number) => `${n.toLocaleString('en-US')} sq ft`

/**
 * New-lead / booking-request alert text (PLAN.md 7.6, ≤ 320 characters plus the map image).
 * Lines drop from the bottom of the body when space runs out; the link always stays.
 */
export function alertText(lead: SummaryLead, bookings: SummaryBooking[], baseUrl: string, kind: 'new' | 'booking'): string {
  const s = summarizeLead(lead, bookings, { baseUrl })
  const test = isTestLead(lead) ? '[TEST] ' : ''
  const price = s.price
  const live = requestBookings(bookings).find(b => b.status !== 'canceled')
  const priceLine = kind === 'booking'
    ? price ? `${priceShort(price)}${price.firstVisitPct ? ` (−${price.firstVisitPct}%)` : ''}` : null
    : price ? `${BOOKING_LABEL[s.booking]} · saw ${priceShort(price).replace(' · 1st', ', 1st')}`
      : `No price${s.services.length ? ` · wants ${s.services.join(', ').toLowerCase()}` : ''}`
  const request = [s.services.join(', ') || null, s.frequencyLabel].filter(Boolean).join(' · ') || null
  const place = shortAddress(lead.address)
  const sourceLine = s.source.detail && s.source.channel === 'Facebook ad'
    ? `${s.source.channel} · ${s.source.detail.replace(' · ', ' ')}` : s.source.conviflo && s.source.channel !== 'ConviFlo form'
      ? `ConviFlo · ${s.source.channel}` : s.source.channel
  const answers = price ? [] : s.answers.slice(0, 3).map(a => `${a.label}: ${a.value}`)
  const addons = live?.addon_interest && asObject(live.addon_interest) ? serviceLabels(Object.keys(asObject(live.addon_interest)!)) : []
  const lines = kind === 'booking' ? [
    `${test}BOOKING REQUEST · ${s.name}`,
    ['Wants', s.wanted.label ?? 'date TBD', s.frequencyLabel].filter(Boolean).join(' · ').replace('Wants ·', 'Wants'),
    priceLine,
    addons.length ? `Add-ons: ${addons.join(', ').toLowerCase()}` : null,
    s.notes ? `"${s.notes.slice(0, 80)}"` : null,
    [place, s.tracedSqFt ? sqFt(s.tracedSqFt) : null].filter(Boolean).join(' · ') || null,
    dialable(lead.phone) ? s.phoneDisplay : 'No valid phone',
    s.link,
  ] : [
    `${test}NEW LEAD · ${s.name}`,
    priceLine,
    request,
    ...answers,
    s.tracedSqFt ? `${sqFt(s.tracedSqFt)}${Array.isArray(lead.lawn_tracing) && lead.lawn_tracing.length ? ' traced' : ''}` : null,
    place,
    dialable(lead.phone) ? s.phoneDisplay : 'No valid phone',
    sourceLine,
    s.link,
  ]
  return fit(lines, 320)
}

/** First name plus last initial, for the spoken prompt: "Jane S." */
export function spokenName(lead: Pick<SummaryLead, 'name'>): string {
  const parts = (lead.name ?? '').replace(/[^\p{L}\p{N}' -]/gu, ' ').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'No name given'
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0]
}

/** Spoken alert prompt (PLAN.md 7.6). Plain text; the phone code escapes it for TwiML. */
export function spokenPrompt(lead: SummaryLead, bookings: SummaryBooking[], kind: 'new' | 'booking'): string {
  const s = summarizeLead(lead, bookings)
  const what = (s.services[0] ?? 'lawn care').toLowerCase()
  const when = s.wanted.date
    ? [new Date(`${s.wanted.date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long' }), s.wanted.window].filter(Boolean).join(' ')
    : null
  const intro = kind === 'booking'
    ? `Booking request. ${spokenName(lead)} wants ${when ?? 'a visit'}, ${what}.`
    : `New lead. ${[spokenName(lead), s.city].filter(Boolean).join(', ')}, ${what}.`
  return `${isTestLead(lead) ? 'Test. ' : ''}${intro} Press 1 to call them now. Press 2 to pass.`
}

/** Texts that keep the other person informed (PLAN.md 7.3, E10). */
export const staffText = {
  claimed: (lead: SummaryLead, staffName: string) => clean(`${staffName} took ${nameOf(lead)} ${phoneDisplay(lead.phone)}`),
  notTaken: (lead: SummaryLead) => clean(`Nobody took ${nameOf(lead)} · call now: ${phoneDisplay(lead.phone) || 'no valid phone'}`),
  reminder: (lead: SummaryLead, baseUrl: string) => clean(`Log your call with ${nameOf(lead)}: ${lead.short_code ? leadLink(baseUrl, lead.short_code) : ''}`),
  /** Dial-yourself mode (E16): the claimer gets the number to tap. */
  callNow: (lead: SummaryLead) => clean(`Call ${nameOf(lead)} now: ${phoneDisplay(lead.phone) || 'no valid phone'}`),
  bookedOnline: (lead: SummaryLead, bookings: SummaryBooking[]) => {
    const s = summarizeLead(lead, bookings)
    return clean(`${nameOf(lead)} just booked online: ${[s.wanted.label ?? 'date TBD', s.price ? priceShort(s.price) : null].filter(Boolean).join(' · ')}`)
  },
  /** "Jane Smith: 🟢 Booked Tue Nov 4 · $45/visit" from a Log call activity's outcome and data. */
  outcome: (lead: SummaryLead, outcome: string, data: Record<string, unknown> = {}) => {
    if (!isCallOutcome(outcome)) return ''
    const def = CALL_OUTCOME[outcome]
    const cents = typeof data.price_cents === 'number' ? data.price_cents : null
    const freq = normalizeFrequency(data.frequency)
    const priceText = cents ? (freq && freq !== 'onetime' ? `${money(cents)}/visit` : money(cents)) : null
    const reason = typeof data.reason === 'string' ? (isQuotedReason(data.reason) ? QUOTED_REASON_LABEL[data.reason] : isClosedReason(data.reason) ? CLOSED_REASON_LABEL[data.reason] : null) : null
    const parts = [
      outcome === 'booked' ? `${def.label} ${dayLabel(String(data.first_visit_on ?? ''), true) ?? ''}`.trim() : def.label,
      reason, priceText, outcome === 'not_now' && data.check_back_on ? `check back ${dayLabel(String(data.check_back_on))}` : null,
    ]
    return clean(`${nameOf(lead)}: ${def.icon} ${parts.filter(Boolean).join(' · ')}`)
  },
}

export type HistoryIcon = 'in' | 'phone' | 'alert' | 'call' | 'quote' | 'board' | 'note' | 'booking'
export type HistoryActivity = { kind: string; outcome?: string | null; body?: string | null; data?: unknown; occurred_at: string; actor_email?: string | null }

/** History row: time · icon · 2–3 words (PLAN.md 4.1d rule 6). `quote` is the staff/customer's own words, if any. */
export function historyItem(activity: HistoryActivity, now = Date.now()): { time: string; icon: HistoryIcon; text: string; quote: string | null } {
  const data = asObject(activity.data) ?? {}
  const staff = typeof data.staff === 'string' ? data.staff : null
  const o = activity.outcome ?? ''
  let icon: HistoryIcon = 'note', text = 'Note'
  if (activity.kind === 'alert') {
    icon = 'alert'
    text = o === 'taken' ? `${staff ?? 'Someone'} took alert` : o === 'passed' ? `${staff ?? 'Someone'} passed`
      : o === 'not_taken' ? 'Nobody took it' : o === 'sent' ? `Alert to ${staff ?? 'staff'}` : 'Alert'
  } else if (activity.kind === 'phone') {
    icon = 'phone'
    const mins = Math.max(1, Math.round((Number(data.duration_seconds) || 0) / 60))
    text = o === 'talked' ? `Talked ${mins} min` : o === 'hung_up_early' ? 'Hung up before they answered' : 'Called, no answer'
  } else if (activity.kind === 'call') {
    icon = 'call'
    if (isCallOutcome(o)) {
      const reason = typeof data.reason === 'string' ? (isQuotedReason(data.reason) ? QUOTED_REASON_LABEL[data.reason] : isClosedReason(data.reason) ? CLOSED_REASON_LABEL[data.reason] : null) : null
      text = [o === 'booked' ? `Booked ${dayLabel(String(data.first_visit_on ?? ''), true) ?? ''}`.trim() : CALL_OUTCOME[o].label, reason?.toLowerCase()].filter(Boolean).join(' · ')
    } else text = o === 'reached' ? 'Reached' : o === 'wrong_number' ? 'Wrong number' : o === 'no_answer' ? 'No answer' : 'Call'
  } else if (activity.kind === 'quote') {
    icon = o === 'booked_online' ? 'booking' : 'quote'
    text = ({ emailed: 'Quote emailed', booked_online: 'Booked online', reviewed: 'Quote saved', draft_saved: 'Draft saved',
      accepted: 'Quote accepted', declined: 'Said no to quote', canceled: 'Quote canceled', draft: 'Quote reopened' } as Record<string, string>)[o] ?? 'Quote'
  } else if (activity.kind === 'board') {
    icon = 'board'; text = `Moved to ${isColumn(o) ? COLUMN_LABEL[o] : o}`
  } else if (activity.kind === 'stage') {
    icon = 'board'; text = `Marked ${o}`
  } else if (activity.kind === 'follow_up') {
    icon = 'call'; text = o === 'cleared' ? 'Follow-up cleared' : 'Follow-up set'
  } else if (o === 'contact_address_changed') text = 'Address changed'
  else if (o === 'contact_updated') text = 'Contact updated'
  const quote = activity.kind === 'note' || activity.kind === 'call' ? activity.body?.trim() || null : null
  return { time: clockLabel(activity.occurred_at, now), icon, text, quote }
}

/** The column chip summarizeLead puts first, for screens that change the column before the server answers. */
export function columnChip(column: BoardColumn): Chip {
  return { key: 'column', label: COLUMN_LABEL[column], tone: column === 'booking_request' ? 'warn' : column === 'customer' ? 'ok' : column === 'closed' ? 'neutral' : 'accent' }
}

/** History row with its sort time (the lead page merges these with activities). */
export type HistoryRow = { at: string; time: string; icon: HistoryIcon; text: string; quote: string | null }
/** One `lead_calls` row with leg = 'alert'. */
export type AlertLeg = {
  staff_name?: string | null; status?: string | null; result?: string | null
  answered_at?: string | null; ended_at?: string | null; created_at: string
}
// Pressing 1 or 2 (or losing the race) means the phone answered; who took it or passed is an activity row.
const LEG_RESULT: Record<string, string> = { answered: 'answered', claimed: 'answered', passed: 'answered', lost_race: 'answered',
  busy: 'busy', no_answer: 'no answer', failed: 'failed', canceled: 'stopped' }

/**
 * Automatic alert-call facts for History (PLAN.md 7.2b, 7.2c): "Alert to Caelan" when the leg
 * starts, then "Caelan's phone: no answer" once the leg's result is known. Took it / passed come
 * from the 'alert' activities, so they are not repeated here.
 */
export function alertLegHistory(leg: AlertLeg, now = Date.now()): HistoryRow[] {
  const name = leg.staff_name?.trim() || null
  const rows: HistoryRow[] = [{ at: leg.created_at, time: clockLabel(leg.created_at, now), icon: 'alert', text: `Alert to ${name ?? 'staff'}`, quote: null }]
  const word = LEG_RESULT[leg.result ?? ''] ?? (leg.answered_at ? 'answered' : null)
  if (word) {
    // An answer comes before the keypress activity, so without answered_at fall back to the ring start.
    const at = word === 'answered' ? leg.answered_at ?? leg.created_at : leg.ended_at ?? leg.answered_at ?? leg.created_at
    rows.push({ at, time: clockLabel(at, now), icon: 'phone', text: `${name ? `${name}'s` : 'Staff'} phone: ${word}`, quote: null })
  }
  return rows
}

/** "$45/visit · every 2 wks · Oct 28"; one-time prices read "$120 total · Oct 28". */
export function priceLine(price: Price): string {
  return [price.recurring ? `${money(price.cents)}/visit` : `${money(price.cents)} total`,
    price.recurring && price.frequency ? FREQUENCY_LABEL[price.frequency] : null, dayLabel(price.at)].filter(Boolean).join(' · ')
}

export type PriceRow = { key: 'website' | 'phone' | 'quote' | 'accepted' | 'booking'; label: string; value: string; price: Price }

/**
 * Every price we know for the lead (PLAN.md 4.1f, S10), so the website price stays visible after a
 * phone price or quote replaces it as the headline. `headline` is leadPrice's pick; `others` are the
 * rest as label → value rows, newest first.
 */
export function allPrices(lead: SummaryLead, bookings: SummaryBooking[] = []): { headline: Price | null; others: PriceRow[] } {
  const rows = priceRows(lead, bookings)
  const headline = leadPrice(lead, bookings)
  const index = headline ? rows.findIndex(row => row.price.source === headline.source && row.price.at === headline.at && row.price.cents === headline.cents) : -1
  const others = rows.filter((_, i) => i !== index).sort((a, b) => time(b.price.at) - time(a.price.at))
  return { headline, others: others.map(({ key, label, price }) => ({ key, label, price, value: priceLine(price) })) }
}
