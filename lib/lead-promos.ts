// lib-ok: read by lib/lead-summary.ts, which the board, lead page and alert texts all share
/**
 * Ad offers a lead was shown, so staff honor them when quoting. The forms don't apply discounts;
 * this only tags the lead. Pure: no database, no env.
 *
 * An offer applies when the lead came through that offer's ConviFlo form before the deadline.
 * Only the matching Meta ads link to each form, so everyone on it saw the offer.
 */

type PromoLead = { created_at?: string | null; answers?: unknown }
export type LeadPromo = { key: string; label: string; short: string }

const GARDEN_BEDS_FORM = 'e8d6472d-9c4c-488d-9f75-c495ac759e99' // conviflo.com/f/krvv0c0r
const LEAVES_GUTTERS_FORM = 'b521838c-6883-46d3-9e07-22a78a374ab4' // conviflo.com/f/vzva5t34

/** "Book by Nov 30": through the end of Nov 30, Austin time (CST, UTC−6). */
const FALL_OFFER_ENDS = Date.parse('2026-12-01T06:00:00Z')

const slug = (value: unknown) => typeof value === 'string' ? value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') : ''

export function leadPromo(lead: PromoLead): LeadPromo | null {
  const answers = lead.answers && typeof lead.answers === 'object' && !Array.isArray(lead.answers)
    ? lead.answers as Record<string, unknown> : {}
  const form = answers.conviflo_form_id
  const submitted = Date.parse(String(answers.conviflo_submitted_at ?? lead.created_at ?? ''))
  if (typeof form !== 'string' || !Number.isFinite(submitted) || submitted >= FALL_OFFER_ENDS) return null

  if (form === GARDEN_BEDS_FORM) return { key: 'bed_15', label: '15% off first bed job', short: '15% off bed job' }

  if (form === LEAVES_GUTTERS_FORM) {
    const choice = slug(answers.cleanup_service)
    if (choice.startsWith('both')) return { key: 'bundle_30', label: '$30 off leaves + gutters', short: '$30 off bundle' }
    if (choice === 'leaf_cleanup') return { key: 'bundle_30_offer', label: '$30 off if they add gutters', short: 'Offer: +gutters $30 off' }
    if (choice === 'gutter_cleaning') return { key: 'bundle_30_offer', label: '$30 off if they add leaf cleanup', short: 'Offer: +leaves $30 off' }
    return { key: 'bundle_30_offer', label: '$30 off if they book leaves + gutters', short: 'Offer: bundle $30 off' }
  }
  return null
}
