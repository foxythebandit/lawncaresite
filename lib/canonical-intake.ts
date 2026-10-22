import { cleanAttribution, type Attribution } from './attribution'
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected object')
  return value as Record<string, unknown>
}
function text(value: unknown, max: number, required = false): string | null {
  if (value == null && !required) return null
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error('Invalid text field')
  return value.trim()
}
/** This is QuietGreen's contract, not an asserted ConviFlo wire format. */
export function canonicalIntake(input: unknown) {
  const data = object(input)
  if (data.version !== 1) throw new Error('Unsupported version')
  const submission = text(data.submission_id, 128, true)!
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(submission)) throw new Error('Invalid submission_id')
  const contact = object(data.contact)
  const phone = text(contact.phone, 30, true)!
  if (!/^[\d\s()+-]{7,30}$/.test(phone)) throw new Error('Invalid phone')
  const email = text(contact.email, 254)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Invalid email')
  if (!Array.isArray(data.services) || data.services.length > 20) throw new Error('Invalid services')
  const services = data.services.map(s => text(s, 100, true))
  const answers = data.answers == null ? {} : object(data.answers)
  if (JSON.stringify(answers).length > 12000 || Object.keys(answers).length > 50) throw new Error('Answers too large')
  const attr = cleanAttribution((data.attribution == null ? {} : object(data.attribution)) as Attribution)
  const consent = data.consent == null ? null : object(data.consent)
  if (consent && typeof consent.granted !== 'boolean') throw new Error('Invalid consent')
  const consentText = consent ? text(consent.text, 1000, consent.granted === true) : null
  const consentVersion = consent ? text(consent.version, 100, consent.granted === true) : null
  const consentAt = consent ? text(consent.timestamp, 50, consent.granted === true) : null
  if (consentAt && (!Number.isFinite(Date.parse(consentAt)) || Date.parse(consentAt) > Date.now() + 300000)) throw new Error('Invalid consent timestamp')
  for (const key of ['score','estimated_value']) if (data[key] != null && (typeof data[key] !== 'number' || !Number.isFinite(data[key]) || (data[key] as number) < 0)) throw new Error('Invalid estimate')
  return { submission, lead: {
    name: text(contact.name, 150), phone, email, address: text(contact.address, 500, true),
    form_version: text(data.form_version, 100, true), services, answers,
    timing: text(data.timing, 150), frequency: text(data.frequency, 50), attribution: attr,
    gclid: attr.first_touch?.gclid || null, gbraid: attr.first_touch?.gbraid || null,
    wbraid: attr.first_touch?.wbraid || null,
    google_campaign_id: attr.first_touch?.google_campaign_id || null,
    google_adgroup_id: attr.first_touch?.google_adgroup_id || null,
    google_ad_id: attr.first_touch?.google_ad_id || null,
    utm_source: attr.first_touch?.utm_source || null,
    utm_medium: attr.first_touch?.utm_medium || null, utm_campaign: attr.first_touch?.utm_campaign || null,
    utm_term: attr.first_touch?.utm_term || null, utm_content: attr.first_touch?.utm_content || null,
    consent: consent?.granted === true, consent_text: consentText, consent_version: consentVersion, consented_at: consentAt,
    score: data.score ?? null, estimated_value: data.estimated_value ?? null,
  } }
}
