/** Operational job price; accepted quote snapshots are separate and immutable. */
export function jobPrice(job: { job_total?: number | string | null; first_visit_price?: number | null; price_per_visit?: number | null }): number {
  return Number(job.job_total ?? job.first_visit_price ?? job.price_per_visit ?? 0)
}

export function moneyCents(value: number | string): number {
  const text = String(value).trim()
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(text)) throw new Error('Enter dollars and cents.')
  const [dollars, cents = ''] = text.split('.')
  const result = Number(dollars) * 100 + Number(cents.padEnd(2, '0'))
  if (!Number.isSafeInteger(result)) throw new Error('Amount is too large.')
  return result
}

export function centsAmount(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error('Amount must be integer cents.')
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
}

/** Next visit date for a plan that starts on `on` (calendar months clamp to month end). */
export function addInterval(on: string, unit: 'week' | 'month', count: number) {
  const date = new Date(`${on}T12:00:00Z`)
  if (unit === 'week') date.setUTCDate(date.getUTCDate() + 7 * count)
  else {
    const day = date.getUTCDate()
    date.setUTCDate(1)
    date.setUTCMonth(date.getUTCMonth() + count)
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
    date.setUTCDate(Math.min(day, lastDay))
  }
  return date.toISOString().slice(0, 10)
}

const usdCents = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const usdWhole = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

/** Line items, prices and payments: always dollars and cents ($1,783.50). */
export function formatMoney(value: number | string | null | undefined) {
  return usdCents.format(Number(value ?? 0))
}

/** Headline totals in summary tiles: whole dollars ($1,784). */
export function formatMoneyWhole(value: number | string | null | undefined) {
  return usdWhole.format(Math.round(Number(value ?? 0)))
}

/** Plain-language job status shown to staff; stored values stay pending/confirmed/completed. */
export function jobStatusLabel(status: string) {
  return ({ pending: 'To schedule', confirmed: 'Scheduled', completed: 'Done', canceled: 'Canceled', skipped: 'Skipped' } as Record<string, string>)[status] ?? status
}

export type JobLine = { kind: 'service' | 'discount'; description: string; amount: string }
export type ActionResult = { success: true; data?: Record<string, unknown> } | { success: false; error: string }

export function commandError(error: { code?: string; message?: string } | null): string {
  if (!error) return 'Could not save. Please retry.'
  if (error.code === 'PT409') return 'This record changed. Refresh and review the latest version.'
  if (error.code === '23505') return 'This request was already used for a different change.'
  return error.message || 'Could not save. Please retry.'
}

type ForecastJob = {
  id: string; name: string; phone: string; address: string; status: string
  created_at: string; agreement_id?: string | null; customer_id?: string | null
  property_id?: string | null; one_time?: boolean | null; frequency?: string | null
  sq_ft?: number | null; job_total?: number | string | null; price_per_visit?: number | null
}
type ForecastAgreement = {
  id: string; status: string; customer_id: string; property_id: string
  price_per_visit: number | string | null
  items_template: { kind: string; description: string }[]
}

/** Conservative mowing outlook. Legacy grouping is a report key, never a customer merge. */
export function mowingForecast(jobs: ForecastJob[], agreements: ForecastAgreement[],
  customers: { id: string; name: string | null }[]) {
  const rows: { id: string; href: string; name: string; perVisit: number; annual: number }[] = []
  const activeAgreements = agreements.filter(a => a.status === 'active')
  const coveredIdentities = new Set(agreements.map(a => `${a.customer_id}:${a.property_id}`))
  const coveredAddresses = new Set<string>()
  for (const agreement of agreements) {
    const related = jobs.find(job => job.agreement_id === agreement.id)
    if (related) coveredAddresses.add(`${related.phone.replace(/\D/g, '')}:${related.address.trim().toLowerCase()}`)
  }
  for (const agreement of activeAgreements) {
    const related = jobs.find(job => job.agreement_id === agreement.id)
    if (!agreement.items_template.some(item => item.kind === 'service'
      && /(mow|lawn care|grass cut)/i.test(item.description))) continue
    const perVisit = Number(agreement.price_per_visit ?? 0)
    if (perVisit <= 0) continue
    rows.push({ id: agreement.id, href: `/admin/customers/${agreement.customer_id}`,
      name: customers.find(c => c.id === agreement.customer_id)?.name ?? related?.name ?? 'Customer',
      perVisit, annual: perVisit * 30 })
  }
  const legacy = new Map<string, ForecastJob>()
  for (const job of jobs) {
    if (job.agreement_id || job.status !== 'confirmed' || job.one_time || !job.frequency
      || /^(one[ -]?time|single|once)$/i.test(job.frequency.trim())) continue
    const identity = job.customer_id && job.property_id ? `${job.customer_id}:${job.property_id}` : null
    const addressKey = `${job.phone.replace(/\D/g, '')}:${job.address.trim().toLowerCase()}`
    if ((identity && coveredIdentities.has(identity)) || coveredAddresses.has(addressKey)) continue
    const key = identity ?? addressKey
    const previous = legacy.get(key)
    if (!previous || job.created_at > previous.created_at) legacy.set(key, job)
  }
  for (const job of legacy.values()) {
    const perVisit = Number(job.job_total ?? job.price_per_visit ?? 0)
    if (perVisit <= 0) continue
    rows.push({ id: job.id, href: job.customer_id ? `/admin/customers/${job.customer_id}`
      : `/admin/client/${encodeURIComponent(job.phone)}`,
      name: `${job.name} · ${job.address} (legacy estimate)`, perVisit, annual: perVisit * 30 })
  }
  return rows.sort((a, b) => b.annual - a.annual)
}
