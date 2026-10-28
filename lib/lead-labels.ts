/**
 * Plain-word labels for where a lead came from and what they answered (PLAN.md section 5).
 * The two tables below are filled from docs/ops-plan/RESEARCH-ads.md (A1, A2). Add rows; never
 * guess a name for an unknown ID — unknown ads show as "Facebook ad" plus Details › Tracking.
 */

/** A1: Meta ad ID → short display name. `short` is what fits on a card and in the alert text. */
export const AD_NAMES: Record<string, { code: string; name: string; short: string; format: 'video' | 'image'; group: 'AI' | 'Real People' }> = {
  // docs/ops-plan/RESEARCH-ads.md section 1 (Ads Manager, 28 Oct 2026); same IDs as lib/attribution.ts.
  '120253769117370725': { code: 'AI-V01', name: 'Everybody Loves Dave', short: 'Dave', format: 'video', group: 'AI' },
  '120253769229100725': { code: 'AI-V02', name: 'I Married That Guy', short: 'Married That Guy', format: 'video', group: 'AI' },
  '120253769229110725': { code: 'AI-V03', name: 'Youre Welcome', short: 'Youre Welcome', format: 'video', group: 'AI' },
  '120253769229120725': { code: 'AI-I01', name: 'Electric Mowing', short: 'Electric Mowing', format: 'image', group: 'AI' },
  '120253769229130725': { code: 'AI-I02', name: 'Split Yard', short: 'Split Yard', format: 'image', group: 'AI' },
  '120253769229140725': { code: 'AI-I03', name: 'Weekend Back', short: 'Weekend Back', format: 'image', group: 'AI' },
  '120253769297420725': { code: 'REAL-V01', name: 'Night Mowing', short: 'Night Mowing', format: 'video', group: 'Real People' },
  '120253769297460725': { code: 'REAL-V02', name: 'Testimonial', short: 'Testimonial', format: 'video', group: 'Real People' },
  '120253769297470725': { code: 'REAL-V03', name: 'Leaf Cleanup', short: 'Leaf Cleanup', format: 'video', group: 'Real People' },
  '120253769297440725': { code: 'REAL-I01', name: 'Alarm Clock', short: 'Alarm Clock', format: 'image', group: 'Real People' },
  '120253769297430725': { code: 'REAL-I02', name: 'Cleaner Cut', short: 'Cleaner Cut', format: 'image', group: 'Real People' },
  '120253769297480725': { code: 'REAL-I03', name: 'Before and After', short: 'Before and After', format: 'image', group: 'Real People' },
}

/** Google Ads campaign ID or utm_campaign → name. */
export const GOOGLE_CAMPAIGN_NAMES: Record<string, string> = {}

/**
 * A2: ConviFlo answer keys → question text, and choice slugs → answer text. Keys not listed
 * fall back to a humanized key ("lawn_size" → "Lawn size"), so nothing is ever hidden.
 */
export const CONVIFLO_QUESTIONS: Record<string, string> = {
  // docs/ops-plan/RESEARCH-ads.md section 2. Short header nouns, not the full question text.
  // Mowing form
  mowing_frequency: 'Mowing plan', yard_size: 'Property size', urgency: 'How soon', lawn_condition: 'Lawn condition',
  // Leaves & Gutters form
  cleanup_service: 'Cleanup', property_size: 'Property size', home_type: 'Home',
  postcode: 'ZIP', zip: 'ZIP',
  // Older lead forms
  budget: 'Budget', decision_maker: 'Decision maker',
}
export const CONVIFLO_CHOICES: Record<string, string> = {
  one_time_mowing: 'One-time mowing', ongoing_mowing: 'Ongoing mowing', not_sure_yet: 'Not sure yet', not_sure: 'Not sure',
  under_1_4_acre: 'Under 1/4 acre', '1_4_1_2_acre': '1/4–1/2 acre', '1_2_1_acre': '1/2–1 acre', '1_acres': '1+ acres', i_m_not_sure: 'Not sure',
  asap: 'ASAP', this_week: 'This week', next_1_2_weeks: 'Next 1–2 weeks', just_checking_prices: 'Just checking prices',
  just_needs_a_regular_mow: 'Regular mow', a_little_overgrown: 'A little overgrown', very_overgrown: 'Very overgrown',
  leaf_cleanup: 'Leaf cleanup', gutter_cleaning: 'Gutter cleaning', both_leaves_and_gutters: 'Leaves + gutters',
  both_leaves_and_gutters_save_30: 'Leaves + gutters',
  single_story: 'Single-story', two_story: 'Two-story', three_stories_or_a_steep_roof: '3 stories / steep roof', no_gutters_on_my_home: 'No gutters',
  // landing page form (choice_N keys shifted over time; slugs don't collide)
  yes_it_drives_me_crazy: 'Yes, it drives me crazy', not_really_i_just_need_it_done_right: 'Just needs it done right',
  yes_that_s_what_i_want: 'Yes', yes_i_want_quiet_lawn_care: 'Yes, wants quiet lawn care',
  loud_equipment_and_gas_fumes: 'Loud equipment, gas fumes', no_shows_and_random_arrival_times: 'No-shows, random arrival times',
  surprise_bills_or_rising_prices: 'Surprise bills, rising prices', sloppy_work_missed_spots_clippings_left_behind: 'Sloppy work',
  i_do_it_myself_and_i_m_over_it: 'DIY, over it',
  mowing_only: 'Mowing only', mowing_edging: 'Mowing + edging', full_cleanup_mow_edge_blow: 'Full cleanup (mow, edge, blow)',
  regular_maintenance_plan: 'Regular maintenance plan',
  yes: 'Yes', no: 'No',
}
/**
 * Landing-page `choice_N` keys were renumbered when a question was added, so for those keys the
 * question comes from the answer's slug (slugs never repeat across questions).
 */
const QUESTION_BY_CHOICE: Record<string, string> = Object.fromEntries([
  ['Opener', ['yes_it_drives_me_crazy', 'not_really_i_just_need_it_done_right', 'yes_that_s_what_i_want', 'yes_i_want_quiet_lawn_care']],
  ['Pain point', ['loud_equipment_and_gas_fumes', 'no_shows_and_random_arrival_times', 'surprise_bills_or_rising_prices', 'sloppy_work_missed_spots_clippings_left_behind', 'i_do_it_myself_and_i_m_over_it']],
  ['Needs', ['mowing_only', 'mowing_edging', 'full_cleanup_mow_edge_blow', 'regular_maintenance_plan']],
  ['How soon', ['asap', 'this_week', 'next_1_2_weeks', 'just_checking_prices']],
  ['Property size', ['under_1_4_acre', '1_4_1_2_acre', '1_2_1_acre', '1_acres', 'i_m_not_sure']],
].flatMap(([question, slugs]) => (slugs as string[]).map(slug => [slug, question as string])))

/** Request services as plain words. */
const SERVICE_NAMES: Record<string, string> = {
  'lawn care': 'Mowing', mowing: 'Mowing', fertilization: 'Fertilizing', mulch: 'Mulch', leafcleanup: 'Leaf cleanup',
  'leaf cleanup': 'Leaf cleanup', maintenance: 'Bed maintenance', yardclearout: 'Yard clear-out', 'hedge trimming': 'Hedge trimming',
}
export function serviceLabel(value: string): string {
  return SERVICE_NAMES[value.trim().toLowerCase()] ?? humanize(value)
}
export function serviceLabels(services: unknown): string[] {
  const list = Array.isArray(services) ? services.filter((s): s is string => typeof s === 'string' && !!s.trim()) : []
  return [...new Set(list.map(serviceLabel))]
}

export function humanize(value: string): string {
  const text = value.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return text ? text[0].toUpperCase() + text.slice(1) : ''
}

/** Answer keys that are intake plumbing or already shown elsewhere on the page. */
const HIDDEN_ANSWERS = new Set(['name', 'phone', 'email', 'address', 'contact', 'property_address', 'notes', 'project_description',
  'address_needs_review', 'address_missing', 'service_unmapped', 'map_screenshot_url', 'addon_interest', 'waitlist'])

/** Customer answers as label → value rows (Request block, alert text). Free text stays as typed. */
export function readableAnswers(answers: unknown): { label: string; value: string }[] {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return []
  return Object.entries(answers as Record<string, unknown>)
    .filter(([key, value]) => !HIDDEN_ANSWERS.has(key) && !key.startsWith('conviflo_') && !/(password|secret|token|key)$/i.test(key)
      && ['string', 'number', 'boolean'].includes(typeof value) && String(value).trim() !== '')
    .map(([key, value]) => {
      const raw = String(value).trim()
      const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
      const label = (/^(choice(_\d+)?|opener_[a-z_]+)$/.test(key) ? QUESTION_BY_CHOICE[slug] : null) ?? CONVIFLO_QUESTIONS[key] ?? humanize(key)
      const shown = typeof value === 'boolean' ? (value ? 'Yes' : 'No')
        : CONVIFLO_CHOICES[raw] ?? CONVIFLO_CHOICES[slug] ?? (/^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(raw) ? humanize(raw) : raw)
      return { label, value: shown }
    })
}

type Touch = Partial<Record<string, unknown>>
const str = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null

/** Where a lead came from, in plain words: a channel chip plus an optional ad/campaign chip. */
export function leadSource(lead: { source?: string | null; attribution?: unknown } & Touch): { channel: string; detail: string | null; conviflo: boolean } {
  const attribution = lead.attribution && typeof lead.attribution === 'object' && !Array.isArray(lead.attribution)
    ? lead.attribution as Record<string, unknown> : {}
  const first = attribution.first_touch && typeof attribution.first_touch === 'object' ? attribution.first_touch as Touch : attribution
  const touch: Touch = Object.keys(first).length ? first : lead
  const conviflo = lead.source === 'conviflo'
  const source = str(touch.utm_source)?.toLowerCase() ?? ''
  const adId = str(touch.meta_ad_id) ?? (source === 'meta' && touch.utm_campaign === '120253769117350725' ? str(touch.utm_content) : null)
  const ad = adId && Object.hasOwn(AD_NAMES, adId) ? AD_NAMES[adId] : null
  if (ad || adId || touch.fbclid || ['meta', 'facebook', 'fb', 'instagram', 'ig'].includes(source)) {
    return { channel: 'Facebook ad', detail: ad ? `${ad.short} · ${ad.format}` : null, conviflo }
  }
  if (touch.gclid || touch.gbraid || touch.wbraid || (source === 'google' && ['cpc', 'ppc', 'paid', 'paid_search'].includes(String(touch.utm_medium ?? '').toLowerCase()))) {
    const campaign = str(touch.google_campaign_id) ?? str(touch.utm_campaign)
    return { channel: 'Google search ad', detail: campaign ? GOOGLE_CAMPAIGN_NAMES[campaign] ?? null : null, conviflo }
  }
  if (source === 'google') return { channel: 'Google search (free)', detail: null, conviflo }
  if (source) return { channel: humanize(source), detail: null, conviflo }
  if (conviflo) return { channel: 'ConviFlo form', detail: null, conviflo }
  return { channel: 'Typed in / unknown', detail: null, conviflo }
}
