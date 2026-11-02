// Ties recorded money back to the Google ad click that first brought a customer in.
// Feeds both the Google Ads offline-conversion upload and the CRM "Google Ads results" report.
// Credit rule (reporting attribution, not a causal claim): a paid visit belongs to the job's own
// gclid, else to the earliest gclid seen for the same customer (or, for legacy jobs without a
// customer, the same phone). Unknown stays unknown.

export const PLAN_CONVERSION = 'CRM paid visit - mowing plan'
export const ONE_TIME_CONVERSION = 'CRM paid visit - one-time'
export const ADS_TIME_ZONE = 'America/Chicago'
// Google Ads accepts click conversions up to 90 days after the click.
const CLICK_WINDOW_DAYS = 90

export type RevenueJob = {
  id: string; name: string; phone: string; created_at: string; status: string
  customer_id?: string | null; agreement_id?: string | null; one_time?: boolean | null; frequency?: string | null
  gclid?: string | null; attribution?: unknown
  amount_charged?: number | string | null; completed_at?: string | null; payment_recorded_at?: string | null
}
export type RevenuePayment = { booking_id: string; amount: number | string; paid_on: string }

type Click = { gclid: string; clickedAt: string; jobId: string }
export type PaidVisit = { jobId: string; paidOn: string; amount: number; plan: boolean; click: Click | null; customerKey: string; name: string }

const ONE_TIME_FREQUENCY = /^(one[ -]?time|single|once)$/i

export function isPlanVisit(job: RevenueJob) {
  if (job.agreement_id) return true
  return job.one_time === false && !!job.frequency && !ONE_TIME_FREQUENCY.test(job.frequency.trim())
}

export function customerKey(job: { customer_id?: string | null; phone: string }) {
  return job.customer_id ? `c:${job.customer_id}` : `p:${job.phone.replace(/\D/g, '')}`
}

function capturedAt(attribution: unknown): string | null {
  if (!attribution || typeof attribution !== 'object') return null
  const value = attribution as { captured_at?: unknown; first_touch?: { captured_at?: unknown } }
  const at = value.first_touch?.captured_at ?? value.captured_at
  return typeof at === 'string' && Number.isFinite(Date.parse(at)) ? at : null
}

/** Calendar date in Central time for a timestamp. */
export function chicagoDate(timestamp: string | Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ADS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(timestamp))
}

function chicagoDateTime(at: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: ADS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(at).map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`
}

/** Earliest Google click per customer (or legacy phone). */
export function firstClicks(jobs: RevenueJob[]) {
  const clicks = new Map<string, Click>()
  for (const job of [...jobs].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const gclid = job.gclid?.trim()
    if (!gclid) continue
    const key = customerKey(job)
    if (!clicks.has(key)) clicks.set(key, { gclid, clickedAt: capturedAt(job.attribution) ?? job.created_at, jobId: job.id })
  }
  return clicks
}

/** Every recorded payment as one paid visit: dated job payments plus legacy amounts on completed jobs. */
export function paidVisits(jobs: RevenueJob[], payments: RevenuePayment[]): PaidVisit[] {
  const clicks = firstClicks(jobs)
  const byId = new Map(jobs.map(job => [job.id, job]))
  const visit = (job: RevenueJob, paidOn: string, amount: number): PaidVisit => {
    const own = job.gclid?.trim()
    const key = customerKey(job)
    const click = own ? { gclid: own, clickedAt: capturedAt(job.attribution) ?? job.created_at, jobId: job.id } : clicks.get(key) ?? null
    return { jobId: job.id, paidOn, amount, plan: isPlanVisit(job), click, customerKey: key, name: job.name }
  }
  const visits: PaidVisit[] = []
  for (const payment of payments) {
    const job = byId.get(payment.booking_id)
    const amount = Number(payment.amount)
    if (job && amount > 0) visits.push(visit(job, payment.paid_on, amount))
  }
  for (const job of jobs) {
    const amount = Number(job.amount_charged ?? 0)
    const paidAt = job.payment_recorded_at ?? job.completed_at
    if (job.status === 'completed' && amount > 0 && paidAt) visits.push(visit(job, chicagoDate(paidAt), amount))
  }
  return visits
}

export type ConversionRow = { gclid: string; name: string; time: string; value: string }

/**
 * Upload rows for Google Ads. Paid date has no time of day, so each visit is placed in the
 * evening (minute varies by job so two visits on one day stay distinct); a same-day payment
 * lands an hour after the click. Visits dated before the click, outside the 90-day click
 * window or not yet in the past are left out.
 */
export function conversionRows(visits: PaidVisit[], now = new Date()): ConversionRow[] {
  const rows: ConversionRow[] = []
  for (const visit of visits) {
    if (!visit.click) continue
    const clicked = new Date(visit.click.clickedAt)
    // Recorded before the click (backfilled history): no honest conversion time exists.
    if (visit.paidOn < chicagoDate(clicked)) continue
    const minute = parseInt(visit.jobId.replace(/-/g, '').slice(0, 4), 16) % 60
    // 18:mm Central, built from the date's noon UTC so DST can't move it to another day.
    const noonUtc = new Date(`${visit.paidOn}T12:00:00Z`)
    const offsetHours = Number(new Intl.DateTimeFormat('en-US', { timeZone: ADS_TIME_ZONE, hour: 'numeric', hourCycle: 'h23' }).format(noonUtc)) - 12
    let at = new Date(Date.UTC(noonUtc.getUTCFullYear(), noonUtc.getUTCMonth(), noonUtc.getUTCDate(), 18 - offsetHours, minute))
    if (at <= clicked) at = new Date(clicked.getTime() + 60 * 60 * 1000)
    if (at >= now) continue
    if (at.getTime() - clicked.getTime() > CLICK_WINDOW_DAYS * 86400000) continue
    rows.push({ gclid: visit.click.gclid, name: visit.plan ? PLAN_CONVERSION : ONE_TIME_CONVERSION,
      time: chicagoDateTime(at), value: visit.amount.toFixed(2) })
  }
  return rows.sort((a, b) => a.time.localeCompare(b.time))
}

function csvCell(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** Google Ads "conversions from clicks" upload file. No names, phones or addresses. */
export function conversionCsv(rows: ConversionRow[]) {
  const lines = [`Parameters:TimeZone=${ADS_TIME_ZONE}`,
    'Google Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency']
  for (const row of rows) lines.push([row.gclid, row.name, row.time, row.value, 'USD'].map(csvCell).join(','))
  return lines.join('\n') + '\n'
}

export type GoogleCustomer = { key: string; name: string; plan: boolean; paid: number; visits: number; firstClick: string }

/** Report rows: customers whose earliest known click is a Google ad, with what they've paid. */
export function googleCustomers(jobs: RevenueJob[], visits: PaidVisit[]): GoogleCustomer[] {
  const clicks = firstClicks(jobs)
  const rows = new Map<string, GoogleCustomer>()
  for (const [key, click] of clicks) {
    const related = jobs.filter(job => customerKey(job) === key)
    const first = related.find(job => job.id === click.jobId)
    rows.set(key, { key, name: first?.name ?? 'Customer', plan: related.some(isPlanVisit), paid: 0, visits: 0, firstClick: chicagoDate(click.clickedAt) })
  }
  for (const visit of visits) {
    const row = visit.click ? rows.get(visit.customerKey) : undefined
    if (!row) continue
    row.paid += visit.amount
    row.visits += 1
  }
  return [...rows.values()].sort((a, b) => b.paid - a.paid || b.firstClick.localeCompare(a.firstClick))
}
