import { quoteTotalCents, type QuoteDraft } from './quote-draft'

export type OfferFrequency = QuoteDraft['freq']
export type OfferOption = { freq: OfferFrequency; label: string; detail: string; price: number; firstVisit: number }
export type QuoteOffer = { recurring: boolean; quoted: OfferFrequency; options: OfferOption[]; sqFt: number }

// Same discounts as the website quote builder.
const FREQ: Record<OfferFrequency, { label: string; detail: string; discount: number }> = {
  weekly:   { label: 'Weekly',    detail: '4× a month · 15% off', discount: 15 },
  biweekly: { label: 'Bi-weekly', detail: '2× a month · 10% off', discount: 10 },
  monthly:  { label: 'Monthly',   detail: '1× a month',           discount: 0 },
  onetime:  { label: 'Just once', detail: 'Single visit',         discount: 0 },
}
const FIRST_VISIT_DISCOUNT_PCT = 30

export const frequencyLabel = (freq: OfferFrequency) => FREQ[freq].label

/**
 * Customer-facing choices for a saved staff quote. A mowing-only quote offers every frequency,
 * derived from the quoted price; any other quote is a single fixed-price job.
 */
export function quoteOffer(draft: QuoteDraft): QuoteOffer {
  const sqFt = draft.sections.reduce((sum, section) => sum + (Number(section.sqFt) || 0), 0)
  const quotedPrice = quoteTotalCents(draft) / 100
  const recurring = draft.includeMowing !== false && !draft.manualLines?.length && !draft.discountCents
  if (!recurring) {
    return { recurring, quoted: 'onetime', sqFt,
      options: [{ freq: 'onetime', label: 'This job', detail: 'Single visit', price: quotedPrice, firstVisit: quotedPrice }] }
  }
  const base = quotedPrice / (1 - FREQ[draft.freq].discount / 100)
  const options = (Object.keys(FREQ) as OfferFrequency[]).map(freq => {
    const price = freq === draft.freq ? quotedPrice : Math.round(base * (1 - FREQ[freq].discount / 100))
    const firstVisit = freq === 'onetime' ? price : Math.round(price * (1 - FIRST_VISIT_DISCOUNT_PCT / 100))
    return { freq, label: FREQ[freq].label, detail: FREQ[freq].detail, price, firstVisit }
  })
  return { recurring, quoted: draft.freq, options, sqFt }
}
