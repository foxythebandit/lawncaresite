import 'server-only'
import { cleanAttribution, type Attribution } from './attribution'
export function websiteLead(data: Attribution & { name?: string; phone: string; email?: string; address: string; sq_ft?: number | null; frequency?: string; preferred_date?: string; notes?: string; addon_interest?: Record<string, unknown> | null }, form: string) {
  if (typeof data.phone !== 'string' || !/^[\d\s()+-]{7,30}$/.test(data.phone) || typeof data.address !== 'string' || !data.address.trim() || data.address.length > 500) throw new Error('Enter a valid phone and address')
  if (data.sq_ft != null && (!Number.isFinite(data.sq_ft) || data.sq_ft < 0 || data.sq_ft > 10000000)) throw new Error('Invalid lawn size')
  const attr = cleanAttribution(data)
  return {
    name: data.name?.trim().slice(0, 150) || null, phone: data.phone.trim(), email: data.email?.trim().slice(0, 254) || null,
    address: data.address.trim() || null, sq_ft: data.sq_ft == null ? null : Math.round(data.sq_ft), form_version: `${form}:1`,
    services: ['Lawn care', ...Object.keys(data.addon_interest ?? {}).filter(k => ['fertilization','mulch','maintenance','yardClearout'].includes(k))], frequency: data.frequency?.slice(0, 50) || null, timing: data.preferred_date || null,
    answers: { notes: data.notes?.slice(0, 2000) }, attribution: attr,
    gclid: attr.first_touch?.gclid || null, gbraid: attr.first_touch?.gbraid || null,
    wbraid: attr.first_touch?.wbraid || null,
    google_campaign_id: attr.first_touch?.google_campaign_id || null,
    google_adgroup_id: attr.first_touch?.google_adgroup_id || null,
    google_ad_id: attr.first_touch?.google_ad_id || null,
    utm_source: attr.first_touch?.utm_source || null,
    utm_medium: attr.first_touch?.utm_medium || null, utm_campaign: attr.first_touch?.utm_campaign || null,
    utm_term: attr.first_touch?.utm_term || null, utm_content: attr.first_touch?.utm_content || null,
  }
}
