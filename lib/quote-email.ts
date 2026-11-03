import { quoteTotalCents, type QuoteDraft } from './quote-draft'
import { FIRST_VISIT_DISCOUNT_PCT, firstVisitCents, planDiscountPct, quoteOffer, type OfferFrequency } from './quote-offer'

/**
 * The emailed quote: one builder for the staff preview and the send, so the customer gets exactly
 * what staff saw. Mowing prices come from the saved quote (same frequency discounts and 30% first
 * visit as the website); staff only choose which plans to show, when each runs, and per-visit add-ons.
 */
export type QuotePlanPart = { freq: OfferFrequency; when: string }
export type QuoteAddOn = { label: string; cents: number }
export type QuoteEmailOptions = { message: string; plans: QuotePlanPart[]; addOns: QuoteAddOn[] }
export type QuoteEmailRow = {
  freq: OfferFrequency; label: string; when: string; detail: string
  mowCents: number; addOnCents: number; perVisitCents: number
  /** Only the plan that starts gets the first-visit price. */
  firstVisitCents: number | null
}
export type QuoteEmailBreakdown = { sqFt: number; recurring: boolean; rows: QuoteEmailRow[]; addOns: QuoteAddOn[] }

/** Inline attachment id the HTML points at; the preview swaps it for the image itself. */
export const MAP_CID = 'lawn-map'
const PLAN_ORDER: OfferFrequency[] = ['weekly', 'biweekly', 'monthly', 'onetime']

export const emailMoney = (cents: number) => cents % 100 === 0
  ? `$${(cents / 100).toLocaleString('en-US')}` : `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function validateQuoteEmailOptions(options: QuoteEmailOptions): string | null {
  if (!options || typeof options.message !== 'string' || !Array.isArray(options.plans) || !Array.isArray(options.addOns)) return 'Refresh and try again.'
  if (!options.message.trim() || options.message.length > 4000) return 'Write a short message to go with the quote.'
  const freqs = options.plans.map(p => p?.freq)
  if (options.plans.length > 4 || new Set(freqs).size !== freqs.length || freqs.some(f => !PLAN_ORDER.includes(f))
    || options.plans.some(p => typeof p.when !== 'string' || p.when.length > 80)) return 'Choose valid plans.'
  if (options.addOns.length > 6 || options.addOns.some(a => typeof a?.label !== 'string' || !a.label.trim() || a.label.length > 60
    || !Number.isSafeInteger(a.cents) || a.cents <= 0 || a.cents > 100000)) return 'Give each add-on a name and a price.'
  return null
}

export function quoteEmailBreakdown(draft: QuoteDraft, options: Pick<QuoteEmailOptions, 'plans' | 'addOns'>): QuoteEmailBreakdown {
  const offer = quoteOffer(draft)
  const addOns = options.addOns.map(a => ({ label: a.label.trim(), cents: a.cents }))
  const addOnCents = addOns.reduce((sum, a) => sum + a.cents, 0)
  if (!offer.recurring) {
    const cents = quoteTotalCents(draft)
    return { sqFt: offer.sqFt, recurring: false, addOns, rows: [{ freq: 'onetime', label: 'This job', when: '', detail: 'Single visit',
      mowCents: cents, addOnCents, perVisitCents: cents + addOnCents, firstVisitCents: null }] }
  }
  const chosen = options.plans.length ? options.plans : [{ freq: offer.quoted, when: '' }]
  const rows = [...chosen].sort((a, b) => PLAN_ORDER.indexOf(a.freq) - PLAN_ORDER.indexOf(b.freq)).map((plan, i) => {
    const option = offer.options.find(o => o.freq === plan.freq)!
    // The quoted frequency keeps the exact saved price (cents allowed); others are whole dollars like the website.
    const mowCents = plan.freq === offer.quoted ? quoteTotalCents(draft) : Math.round(option.price * 100)
    return { freq: plan.freq, label: option.label, when: plan.when.trim(), detail: option.detail, mowCents, addOnCents,
      perVisitCents: mowCents + addOnCents, firstVisitCents: i === 0 && plan.freq !== 'onetime' ? firstVisitCents(mowCents, plan.freq) + addOnCents : null }
  })
  return { sqFt: offer.sqFt, recurring: true, rows, addOns }
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

export function quoteEmailContent({ draft, address, options, bookUrl, hasMap }: {
  draft: QuoteDraft; address: string | null; options: QuoteEmailOptions; bookUrl: string | null; hasMap: boolean
}) {
  const b = quoteEmailBreakdown(draft, options)
  const sqFt = b.sqFt ? `${b.sqFt.toLocaleString('en-US')} sq ft` : null
  const perVisit = (row: QuoteEmailRow) => b.recurring ? `${emailMoney(row.perVisitCents)}/visit` : emailMoney(row.perVisitCents)
  const subject = b.recurring
    ? `Your QuietGreen mowing quote: ${b.rows.map(row => `${row.label.toLowerCase()} ${perVisit(row)}`).join(', ')}`
    : `Your QuietGreen quote: ${emailMoney(b.rows[0].perVisitCents)}`
  const lines = (row: QuoteEmailRow) => [
    { label: b.recurring ? `Mowing${planDiscountPct(row.freq) ? ` (${planDiscountPct(row.freq)}% off)` : ''}` : 'Quoted work', value: emailMoney(row.mowCents) },
    ...b.addOns.map(a => ({ label: a.label, value: `+${emailMoney(a.cents)}` })),
  ]
  const first = b.rows.find(row => row.firstVisitCents !== null)
  const firstNote = first ? `First visit: ${emailMoney(first.firstVisitCents!)} (${FIRST_VISIT_DISCOUNT_PCT}% off mowing${b.addOns.length ? `, ${b.addOns.map(a => a.label.toLowerCase()).join(' and ')} at full price` : ''})` : null

  const text = [
    options.message.trim(), '',
    ...(sqFt ? [`Your lawn: ${sqFt} (measured from the satellite map${hasMap ? ', picture attached' : ''})`, ''] : []),
    ...b.rows.flatMap(row => [
      `${b.recurring ? `${row.label} mowing` : row.label}${row.when ? ` · ${row.when}` : ''}`,
      ...lines(row).map(line => `  ${line.label}: ${line.value}`),
      `  ${b.recurring ? 'Per visit' : 'Total'}: ${emailMoney(row.perVisitCents)}`, '',
    ]),
    ...(firstNote ? [firstNote, ''] : []),
    ...(bookUrl ? [`Review & book: ${bookUrl}`, ''] : []),
    'Reply to this email or call us with any questions.', 'QuietGreen · quietgreen.co',
  ].join('\n')

  const muted = 'color:#4a5e54'
  const rowHtml = (row: QuoteEmailRow) => `<div style="background:#fff;border:1px solid #b7e4c7;border-radius:10px;padding:14px 18px;margin-top:12px">
      <p style="margin:0;font-size:12px;text-transform:uppercase;letter-spacing:.08em;${muted}">${esc(b.recurring ? `${row.label} mowing` : row.label)}${row.when ? ` · ${esc(row.when)}` : ''}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;font-size:14px;color:#111c17;border-collapse:collapse">
      ${lines(row).map(line => `<tr><td style="padding:3px 0;${muted}">${esc(line.label)}</td><td align="right" style="padding:3px 0">${esc(line.value)}</td></tr>`).join('')}
      <tr><td style="padding:8px 0 0;border-top:1px solid #e0ede6;font-weight:600">${b.recurring ? 'Per visit' : 'Total'}</td><td align="right" style="padding:8px 0 0;border-top:1px solid #e0ede6;font-size:20px;font-weight:600;color:#1a3a2a">${emailMoney(row.perVisitCents)}</td></tr>
      </table>${b.recurring ? `<p style="margin:6px 0 0;font-size:12px;${muted}">${esc(row.detail)}</p>` : ''}</div>`
  const html = `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111c17">
    <div style="background:#1a3a2a;padding:24px 28px;border-radius:12px 12px 0 0"><p style="color:#52b788;font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin:0 0 6px">Your quote</p>
    <h1 style="color:#fff;font-size:22px;margin:0">${esc(address || 'QuietGreen lawn care')}</h1></div>
    <div style="background:#f7f6f2;padding:24px 28px;border-radius:0 0 12px 12px;border:1px solid #e0ede6;border-top:none">
    <p style="font-size:15px;line-height:1.6;${muted};margin:0 0 20px;white-space:pre-line">${esc(options.message.trim())}</p>
    ${hasMap ? `<img src="cid:${MAP_CID}" width="464" alt="Your lawn as we traced it${sqFt ? `, ${sqFt}` : ''}" style="display:block;width:100%;height:auto;border-radius:10px;border:1px solid #e0ede6">` : ''}
    ${sqFt ? `<p style="margin:8px 0 4px;font-size:14px;${muted}">Your lawn: <strong style="color:#1a3a2a">${sqFt}</strong>${hasMap ? ' · the highlighted area is what we mow' : ''}</p>` : ''}
    ${b.rows.map(rowHtml).join('')}
    ${firstNote ? `<p style="margin:14px 0 0;font-size:14px;color:#1a3a2a;background:#e0f2e8;border-radius:8px;padding:10px 14px">${esc(firstNote)}</p>` : ''}
    ${bookUrl ? `<a href="${esc(bookUrl)}" style="display:block;text-align:center;background:#1a3a2a;color:#fff;text-decoration:none;font-weight:600;padding:14px;border-radius:10px;font-size:16px;margin-top:18px">Review &amp; book &rarr;</a>
    <p style="font-size:13px;${muted};margin:14px 0 0">Pick your start date and see how we measured your lawn. It takes about 30 seconds.</p>` : ''}
    <p style="font-size:13px;${muted};margin:14px 0 0">Reply to this email or call us with any questions.</p></div></div>`
  return { subject, text, html, breakdown: b }
}

/** One line for the lead history: what was quoted, without the message. */
export function quoteEmailSummary(b: QuoteEmailBreakdown) {
  const plans = b.rows.map(row => `${b.recurring ? `${row.label} ${emailMoney(row.perVisitCents)}/visit` : emailMoney(row.perVisitCents)}${row.when ? ` (${row.when})` : ''}`).join(', ')
  const first = b.rows.find(row => row.firstVisitCents !== null)
  return `${plans}${b.addOns.length ? `, incl. ${b.addOns.map(a => `${a.label.toLowerCase()} +${emailMoney(a.cents)}`).join(', ')}` : ''}${first ? `; first visit ${emailMoney(first.firstVisitCents!)}` : ''}`
}
