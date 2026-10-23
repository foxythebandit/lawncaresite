import { createHash } from 'node:crypto'
import { canonicalIntake } from './canonical-intake'
import { enrichMetaCreative } from './ad-registry'

type FormConfig = {
  services: string[]; address_key: string; map_meta_utm_ids?: boolean
  // Optional: one answer chooses the services, e.g. cleanup_service -> leaves, gutters or both.
  service_key?: string; service_map?: Record<string, string[]>
}

function validServices(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(s => typeof s === 'string' && s.trim() !== '')
}

/** Verified ConviFlo payload fields, mapped only for configured form IDs. */
export function convifloIntake(payload: unknown, forms: Record<string, FormConfig>) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid payload')
  const data = payload as Record<string, unknown>
  if (data.event === 'lead.partial' || data.outcome === 'partial') return null
  if (data.event !== 'lead' || data.outcome !== 'completed') throw new Error('Unsupported event')
  const formId = data.formId
  if (typeof formId !== 'string' || !forms[formId]) throw new Error('Form is not configured')
  if (typeof data.responseId !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(data.responseId)) {
    throw new Error('Completed lead has no stable response ID')
  }
  const form = forms[formId]
  if (!validServices(form.services)) throw new Error('Form services are not configured')
  if (typeof form.address_key !== 'string' || !/^[a-zA-Z0-9_]{1,80}$/.test(form.address_key)) {
    throw new Error('Form address key is not configured')
  }
  const answers = data.answers
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw new Error('Missing answers')
  const fields = answers as Record<string, unknown>
  // An unknown or missing choice keeps the form's default services and is flagged for staff.
  let services = form.services
  let serviceUnmapped = false
  if (form.service_key) {
    // ConviFlo sends choices as label slugs ("Mowing + Edging" -> mowing_edging); match labels too.
    const chosen = fields[form.service_key]
    const slug = typeof chosen === 'string' ? chosen.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') : ''
    const mapped = slug && form.service_map && Object.hasOwn(form.service_map, slug)
      ? form.service_map[slug] : undefined
    if (validServices(mapped)) services = mapped
    else serviceUnmapped = true
  }
  const submittedAddress = fields[form.address_key]
  let address: string | null = null
  if (typeof submittedAddress === 'string') address = submittedAddress.trim()
  else if (submittedAddress && typeof submittedAddress === 'object' && !Array.isArray(submittedAddress)) {
    const parts = submittedAddress as Record<string, unknown>
    if (typeof parts.street === 'string' && parts.street.trim()
      && typeof parts.city === 'string' && parts.city.trim()) {
      address = [parts.street, typeof parts.unit === 'string' ? parts.unit : null, parts.city]
        .filter(Boolean).map(s => String(s).trim()).join(', ')
    }
  }
  // The address is optional on live forms; staff collect it on the callback.
  const meta = data.meta && typeof data.meta === 'object' && !Array.isArray(data.meta)
    ? data.meta as Record<string, unknown> : {}
  const utm = meta.utm && typeof meta.utm === 'object' && !Array.isArray(meta.utm)
    ? meta.utm as Record<string, unknown> : {}
  const attribution = { ...utm }
  if (form.map_meta_utm_ids === true && utm.utm_source === 'meta' && utm.utm_medium === 'paid_social') {
    if (typeof utm.utm_campaign === 'string' && /^\d{1,30}$/.test(utm.utm_campaign)) attribution.meta_campaign_id = utm.utm_campaign
    if (typeof utm.utm_term === 'string' && /^\d{1,30}$/.test(utm.utm_term)) attribution.meta_adset_id = utm.utm_term
    if (typeof utm.utm_content === 'string' && /^\d{1,30}$/.test(utm.utm_content)) attribution.meta_ad_id = utm.utm_content
  }
  const value = typeof data.leadValue === 'number' && Number.isFinite(data.leadValue) && data.leadValue >= 0
    ? data.leadValue : null
  return canonicalIntake({
    version: 1,
    submission_id: createHash('sha256').update(`${formId}:${data.responseId}`).digest('hex'),
    form_version: 'conviflo-adapter:1',
    contact: { name: fields.name, phone: fields.phone, email: fields.email,
      address },
    services,
    answers: { ...fields, address_needs_review: true, address_missing: !address,
      ...(serviceUnmapped ? { service_unmapped: true } : {}), conviflo_form_id: formId,
      conviflo_response_id: data.responseId, conviflo_form_slug: data.formSlug,
      conviflo_submitted_at: data.submittedAt, conviflo_lead_value_horizon: 'unknown' },
    attribution: enrichMetaCreative(attribution, process.env.META_AD_CREATIVES),
    estimated_value: value,
  }, { requireAddress: false })
}
