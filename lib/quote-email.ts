import { centsToAmount, type JobItemInput } from './crm-contracts'
import { quoteTotalCents, type QuoteDraft } from './quote-draft'
import { FIRST_VISIT_DISCOUNT_PCT, firstVisitCents, planDiscountPct, quoteOffer, type OfferFrequency } from './quote-offer'

/**
 * The emailed quote: one builder for the staff preview and the send, so the customer gets exactly
 * what staff saw. Mowing prices come from the saved quote (same frequency discounts and 30% first
 * visit as the website). Each email quotes the saved series with its notes and any add-ons.
 */
export type QuoteAddOn = { label: string; cents: number }
export type QuoteEmailOptions = { message: string; when: string; addOns: QuoteAddOn[] }
export type QuoteEmailRow = {
  freq: OfferFrequency; label: string; when: string; detail: string
  mowCents: number; addOnCents: number; perVisitCents: number
  /** First-visit amount, including all quoted items. */
  firstVisitCents: number | null
  regularItems: JobItemInput[]
  firstItems: JobItemInput[]
}
export type QuoteEmailBreakdown = { sqFt: number; recurring: boolean; rows: QuoteEmailRow[]; addOns: QuoteAddOn[] }

/** Inline attachment id the HTML points at; the preview swaps it for the image itself. */
export const MAP_CID = 'lawn-map'

export const emailMoney = (cents: number) => cents % 100 === 0
  ? `$${(cents / 100).toLocaleString('en-US')}` : `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function validateQuoteEmailOptions(options: QuoteEmailOptions): string | null {
  if (!options || typeof options.message !== 'string' || typeof options.when !== 'string' || !Array.isArray(options.addOns)) return 'Refresh and try again.'
  if (!options.message.trim() || options.message.length > 4000) return 'Write a short message to go with the quote.'
  if (options.when.length > 80) return 'Keep the timing note under 80 characters.'
  if (options.addOns.length > 6 || options.addOns.some(a => typeof a?.label !== 'string' || !a.label.trim() || a.label.length > 60
    || !Number.isSafeInteger(a.cents) || a.cents <= 0 || a.cents > 100000)) return 'Give each add-on a name and a price.'
  return null
}

export function quoteEmailBreakdown(draft: QuoteDraft, options: Pick<QuoteEmailOptions, 'when' | 'addOns'>, introEligible = true): QuoteEmailBreakdown {
  const offer = quoteOffer(draft)
  const addOns = options.addOns.map(a => ({ label: a.label.trim(), cents: a.cents }))
  const addOnCents = addOns.reduce((sum, a) => sum + a.cents, 0)
  const addOnItems = addOns.map(a => quoteItem(a.label, a.cents))
  if (!offer.recurring) {
    const cents = quoteTotalCents(draft)
    const mowing = draft.includeMowing === false ? 0 : Math.round((draft.overridePrice ?? draft.calculatedPrice) * 100)
    const work = [
      ...(mowing > 0 ? [quoteItem('Lawn care', mowing)] : []),
      ...(draft.manualLines ?? []).filter(line => line.amountCents > 0).map(line => quoteItem(line.service, line.amountCents)),
      ...(draft.discountCents ? [quoteItem('Quote discount', -draft.discountCents)] : []),
    ]
    const regularItems = [...work, ...addOnItems]
    return { sqFt: offer.sqFt, recurring: false, addOns, rows: [{ freq: 'onetime', label: 'This job', when: options.when.trim(), detail: 'Single visit',
      mowCents: cents, addOnCents, perVisitCents: cents + addOnCents, firstVisitCents: null, regularItems, firstItems: regularItems }] }
  }
  const option = offer.options.find(row => row.freq === draft.freq)!
  const mowCents = quoteTotalCents(draft)
  const first = firstVisitCents(mowCents, draft.freq, introEligible)
  const regularItems = [quoteItem('Lawn care', mowCents), ...addOnItems]
  const firstItems = first < mowCents ? [...regularItems, quoteItem('Introductory mowing discount', first - mowCents)] : regularItems
  const rows: QuoteEmailRow[] = [{ freq: draft.freq, label: option.label, when: options.when.trim(), detail: option.detail, mowCents, addOnCents,
    perVisitCents: mowCents + addOnCents, firstVisitCents: first < mowCents ? first + addOnCents : null, regularItems, firstItems }]
  return { sqFt: offer.sqFt, recurring: true, rows, addOns }
}

function quoteItem(description: string, cents: number): JobItemInput {
  return { kind: cents < 0 ? 'discount' : 'service', description, amount: centsToAmount(cents) }
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

export function quoteEmailContent({ draft, address, options, bookUrl, hasMap, introEligible, revision }: {
  draft: QuoteDraft; address: string | null; options: QuoteEmailOptions; bookUrl: string | null; hasMap: boolean
  introEligible?: boolean; revision?: 'replaces' | 'proposal'
}) {
  const b = quoteEmailBreakdown(draft, options, introEligible)
  const notice = revision === 'replaces' ? 'This updated quote replaces the previous open quote.'
    : revision === 'proposal' ? 'This is a new proposal for review. Your previous agreement stays in place.' : null
  const sqFt = b.sqFt ? `${b.sqFt.toLocaleString('en-US')} sq ft` : null
  const repeating = (row: QuoteEmailRow) => b.recurring && row.freq !== 'onetime'
  const perVisit = (row: QuoteEmailRow) => `${emailMoney(row.perVisitCents)}${repeating(row) ? '/visit' : ''}`
  const service = (row: QuoteEmailRow) => repeating(row) ? `${row.label} mowing` : b.recurring ? 'One-time mowing' : row.label
  const priceLabel = (row: QuoteEmailRow) => repeating(row) ? 'Per visit' : row.firstVisitCents !== null ? 'Standard price' : 'Total'
  const subject = b.recurring
    ? `Your QuietGreen mowing quote: ${b.rows.map(row => `${row.label.toLowerCase()} ${perVisit(row)}`).join(', ')}`
    : `Your QuietGreen quote: ${emailMoney(b.rows[0].perVisitCents)}`
  const lines = (row: QuoteEmailRow) => b.recurring ? [
    { label: `Mowing${planDiscountPct(row.freq) ? ` (${planDiscountPct(row.freq)}% off)` : ''}`, value: emailMoney(row.mowCents) },
    ...b.addOns.map(a => ({ label: a.label, value: `+${emailMoney(a.cents)}` })),
  ] : row.regularItems.map(item => ({ label: item.description, value: emailMoney(Math.round(Number(item.amount) * 100)) }))
  const first = b.rows.find(row => row.firstVisitCents !== null)
  const firstNote = first ? `First visit: ${emailMoney(first.firstVisitCents!)} (${FIRST_VISIT_DISCOUNT_PCT}% off mowing${b.addOns.length ? `, ${b.addOns.map(a => a.label.toLowerCase()).join(' and ')} at full price` : ''})` : null

  const text = [
    options.message.trim(), '',
    ...(notice ? [notice, ''] : []),
    ...(sqFt ? [`Your lawn: ${sqFt} (measured from the satellite map${hasMap ? ', picture attached' : ''})`, ''] : []),
    ...b.rows.flatMap(row => [
      `${service(row)}${row.when ? ` · ${row.when}` : ''}`,
      ...lines(row).map(line => `  ${line.label}: ${line.value}`),
      `  ${priceLabel(row)}: ${emailMoney(row.perVisitCents)}`, '',
    ]),
    ...(firstNote ? [firstNote, ''] : []),
    ...(bookUrl ? [`Review & request a visit: ${bookUrl}`, ''] : []),
    'Reply to this email or call us with any questions.', 'QuietGreen · quietgreen.co',
  ].join('\n')

  const muted = 'color:#4a5e54'
  const rowHtml = (row: QuoteEmailRow) => `<div style="background:#fff;border:1px solid #b7e4c7;border-radius:10px;padding:14px 18px;margin-top:12px">
      <p style="margin:0;font-size:12px;text-transform:uppercase;letter-spacing:.08em;${muted}">${esc(service(row))}${row.when ? ` · ${esc(row.when)}` : ''}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;font-size:14px;color:#111c17;border-collapse:collapse">
      ${lines(row).map(line => `<tr><td style="padding:3px 0;${muted}">${esc(line.label)}</td><td align="right" style="padding:3px 0">${esc(line.value)}</td></tr>`).join('')}
      <tr><td style="padding:8px 0 0;border-top:1px solid #e0ede6;font-weight:600">${priceLabel(row)}</td><td align="right" style="padding:8px 0 0 8px;border-top:1px solid #e0ede6;font-size:20px;font-weight:600;color:#1a3a2a">${emailMoney(row.perVisitCents)}</td></tr>
      </table>${b.recurring ? `<p style="margin:6px 0 0;font-size:12px;${muted}">${esc(row.detail)}</p>` : ''}</div>`
  const html = `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111c17">
    <div style="background:#1a3a2a;padding:24px 28px;border-radius:12px 12px 0 0"><p style="color:#52b788;font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin:0 0 6px">Your quote</p>
    <h1 style="color:#fff;font-size:22px;margin:0">${esc(address || 'QuietGreen lawn care')}</h1></div>
    <div style="background:#f7f6f2;padding:24px 28px;border-radius:0 0 12px 12px;border:1px solid #e0ede6;border-top:none">
    <p style="font-size:15px;line-height:1.6;${muted};margin:0 0 20px;white-space:pre-line">${esc(options.message.trim())}</p>
    ${notice ? `<p style="${muted}">${esc(notice)}</p>` : ''}
    ${hasMap ? `<img src="cid:${MAP_CID}" width="464" alt="Your lawn as we traced it${sqFt ? `, ${sqFt}` : ''}" style="display:block;width:100%;height:auto;border-radius:10px;border:1px solid #e0ede6">` : ''}
    ${sqFt ? `<p style="margin:8px 0 4px;font-size:14px;${muted}">Your lawn: <strong style="color:#1a3a2a">${sqFt}</strong>${hasMap ? ' · the highlighted area is what we mow' : ''}</p>` : ''}
    ${b.rows.map(rowHtml).join('')}
    ${firstNote ? `<p style="margin:14px 0 0;font-size:14px;color:#1a3a2a;background:#e0f2e8;border-radius:8px;padding:10px 14px">${esc(firstNote)}</p>` : ''}
    ${bookUrl ? `<a href="${esc(bookUrl)}" style="display:block;text-align:center;background:#1a3a2a;color:#fff;text-decoration:none;font-weight:600;padding:14px;border-radius:10px;font-size:16px;margin-top:18px">Review &amp; request a visit &rarr;</a>
    <p style="font-size:13px;${muted};margin:14px 0 0">Choose a preferred date. We’ll confirm the visit with you.</p>` : ''}
    <p style="font-size:13px;${muted};margin:14px 0 0">Reply to this email or call us with any questions.</p></div></div>`
  return { subject, text, html, breakdown: b }
}

/** One line for the lead history: what was quoted, without the message. */
export function quoteEmailSummary(b: QuoteEmailBreakdown) {
  const plans = b.rows.map(row => `${b.recurring ? `${row.label} ${emailMoney(row.perVisitCents)}/visit` : emailMoney(row.perVisitCents)}${row.when ? ` (${row.when})` : ''}`).join(', ')
  const first = b.rows.find(row => row.firstVisitCents !== null)
  return `${plans}${b.addOns.length ? `, incl. ${b.addOns.map(a => `${a.label.toLowerCase()} +${emailMoney(a.cents)}`).join(', ')}` : ''}${first ? `; first visit ${emailMoney(first.firstVisitCents!)}` : ''}`
}
