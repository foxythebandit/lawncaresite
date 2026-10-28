import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireStaff } from '@/lib/staff'
import { adminDb } from '@/lib/supabase/admin'
import { leadToken } from '@/lib/intake'
import { FREQUENCY_LABEL, normalizeFrequency } from '@/lib/lead-board'
import { PRICE_SOURCE_LABEL, ago, dayLabel, historyItem, money, phoneDisplay, requestBookings, summarizeLead,
  type HistoryIcon, type SummaryBooking, type SummaryLead } from '@/lib/lead-summary'
import { humanize, serviceLabels } from '@/lib/lead-labels'
import { signedMapUrl } from '@/lib/map-screenshot'
import { staffByPhone } from '@/lib/staff-directory'
import { processLeadAlert } from '../quote-actions'
import { CopyText, LeadChips, LeadLive, LogCallButton, RecordingButton, TextLink } from '../LeadLive'
import { QuoteMap, QuotePanel, QuoteProvider, type QuoteBooking, type QuoteLead } from '../QuoteTools'
import TracingMap, { tracedShapes } from '../TracingMap'
import Icon, { type IconName } from '../../icons'

export const dynamic = 'force-dynamic'

type Row = { label: string; value: React.ReactNode }
type Alert = { id: string; recipient: string; channel: string; state: string; provider_status: string | null; error_code: string | null; attempts: number; provider_sid: string | null }
type Call = { id: string; leg: string; staff_name: string | null; staff_phone: string; caller_id: string | null; result: string | null; status: string; duration_seconds: number | null; recording_sid: string | null; created_at: string }

const ICON: Record<HistoryIcon, IconName> = { in: 'inbox', phone: 'phone', alert: 'bell', call: 'note', quote: 'tag', board: 'columns', note: 'note', booking: 'calendar' }
const asObject = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const dash = (value: React.ReactNode) => value === null || value === undefined || value === '' ? '—' : value
const stamp = (value: string | null | undefined) => value ? new Date(value).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null
const mins = (seconds: number | null) => `${Math.max(1, Math.round((seconds ?? 0) / 60))} min`

function Block({ title, aside, className = '', children }: { title: string; aside?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return <section className={`crm-block ${className}`}><h2 className="crm-block-head"><span>{title}</span>{aside && <span className="crm-block-aside">{aside}</span>}</h2>{children}</section>
}
function Rows({ rows }: { rows: Row[] }) {
  return <dl className="crm-kv">{rows.map(row => <div key={row.label}><dt>{row.label}</dt><dd>{dash(row.value)}</dd></div>)}</dl>
}
const Pill = ({ tone = 'neutral', children }: { tone?: string; children: React.ReactNode }) => <span className={`crm-pill crm-pill-${tone}`}>{children}</span>

/** Plain words for an alert delivery row (PLAN.md 4.1f: "Sent to Caelan · call · answered"). */
function alertWords(alert: Alert) {
  const who = staffByPhone(alert.recipient)?.name ?? (phoneDisplay(alert.recipient) || 'nobody set up')
  const channel = alert.channel === 'voice' ? 'call' : 'text'
  const status = alert.provider_status?.toLowerCase()
  const state = channel === 'call' && status === 'completed' ? 'answered' : status === 'no-answer' ? 'no answer' : status === 'busy' ? 'busy'
    : ({ delivered: 'delivered', accepted: 'sent', pending: 'waiting', sending: 'sending', disabled: 'off', failed: 'failed', unknown: 'unknown' } as Record<string, string>)[alert.state] ?? alert.state
  return `Sent to ${who} · ${channel} · ${state}${alert.attempts > 1 ? ` · ${alert.attempts} tries` : ''}${alert.error_code ? ` · code ${alert.error_code}` : ''}`
}
function callWords(call: Call) {
  const who = call.staff_name ?? staffByPhone(call.staff_phone)?.name ?? phoneDisplay(call.staff_phone)
  const result = call.result ? humanize(call.result).toLowerCase() : call.status
  const shownAs = call.caller_id && call.caller_id !== call.staff_phone ? ` · shown as ${phoneDisplay(call.caller_id)}` : ''
  return call.leg === 'alert' ? `Alert call to ${who} · ${result}` : `${who} called · ${result}${call.result === 'talked' ? ` ${mins(call.duration_seconds)}` : ''}${shownAs}`
}

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await requireStaff(`/admin/leads/${id}`)
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const db = adminDb()
  const { data: lead } = await db.from('leads').select('*').eq('id', id).single()
  if (!lead) notFound()
  const phoneDigits = String(lead.phone ?? '').replace(/\D/g, '').slice(-10)
  const [{ data: activities }, { data: events }, { data: bookings }, { data: customers }, { data: calls }] = await Promise.all([
    db.from('lead_activities').select('id,kind,outcome,body,actor_email,occurred_at,data').eq('lead_id', id).order('occurred_at').limit(200),
    db.from('intake_events').select('id,source,submission_id,booking_id,created_at,staff_alerts(*)').eq('lead_id', id).order('created_at'),
    db.from('bookings').select('*').eq('lead_id', id).order('created_at'),
    db.from('customers').select('id,name,phone'),
    db.from('lead_calls').select('id,leg,staff_name,staff_phone,caller_id,result,status,duration_seconds,recording_sid,created_at').eq('lead_id', id).order('created_at'),
  ])
  // Same-phone customers are suggestions only; staff confirms before linking.
  const customerMatches = phoneDigits.length === 10 ? (customers ?? []).filter(c => String(c.phone ?? '').replace(/\D/g, '').slice(-10) === phoneDigits) : []
  const linkedCustomer = lead.customer_id ? (customers ?? []).find(c => c.id === lead.customer_id) ?? null : null
  const existing = linkedCustomer ?? customerMatches[0] ?? null
  const quoteUrl = lead.address ? `${new URL(process.env.CRM_BASE_URL ?? 'https://quietgreen.co').origin}/quote/${leadToken(id)}` : null
  // One request timestamp for every relative label on the page.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now()
  const s = summarizeLead(lead as SummaryLead, (bookings ?? []) as SummaryBooking[], { existingCustomer: !!existing, now })
  const answers = asObject(lead.answers)
  const own = requestBookings((bookings ?? []) as SummaryBooking[])
  const live = (own.find(b => b.status !== 'canceled') ?? own[0]) as (SummaryBooking & { lawn_size_bucket?: string | null; map_screenshot_url?: string | null }) | undefined
  const mapUrl = await signedMapUrl(lead.map_screenshot_url ?? (bookings ?? []).map(b => b.map_screenshot_url).filter(Boolean).pop())
  const shapes = tracedShapes(lead.lawn_tracing, lead.quote_draft?.sections)
  const price = s.price
  const addonKeys = Object.keys(asObject(live?.addon_interest ?? answers.addon_interest))
  const addressChanged = (activities ?? []).some(a => a.outcome === 'contact_address_changed')
  const addressChip = s.chips.find(c => c.key === 'address')

  // History: came in, later intake (online booking), every activity; time · icon · 2–3 words.
  const callById = new Map((calls ?? []).map(call => [call.id, call as Call]))
  const history = [
    { key: 'in', at: lead.created_at, time: historyItem({ kind: 'note', occurred_at: lead.created_at }, now).time, icon: 'in' as HistoryIcon, text: 'Came in', quote: null as string | null, recording: null as string | null },
    ...(events ?? []).slice(1).map(event => ({ key: event.id, at: event.created_at, time: historyItem({ kind: 'note', occurred_at: event.created_at }, now).time,
      icon: 'booking' as HistoryIcon, text: event.booking_id ? 'Booked online' : 'Came in again', quote: null, recording: null })),
    ...(activities ?? []).map(activity => {
      const item = historyItem(activity, now)
      const call = callById.get(String(asObject(activity.data).call_id ?? ''))
      return { key: activity.id, at: activity.occurred_at, ...item, recording: call?.recording_sid ? `/api/twilio/recordings/${call.id}` : null }
    }),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))

  const firstTouch = asObject(asObject(lead.attribution).first_touch)
  const latestTouch = asObject(asObject(lead.attribution).latest_touch)
  const touchRows = (touch: Record<string, unknown>) => Object.entries(touch).filter(([, v]) => typeof v === 'string' && v).map(([k, v]) => ({ label: k, value: String(v) }))
  const clickIds = ['gclid', 'gbraid', 'wbraid', 'fbclid', 'fbc', 'fbp'].map(k => ({ label: k, value: (lead[k] as string | null) ?? (firstTouch[k] as string | undefined) ?? null })).filter(r => r.value)
  const rawUtm = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'google_campaign_id', 'google_adgroup_id', 'google_ad_id']
    .map(k => ({ label: k, value: (lead[k] as string | null) ?? null })).filter(r => r.value)
  const alerts = (events ?? []).flatMap(event => ((event.staff_alerts ?? []) as Alert[]).map(alert => ({ alert, event })))
  const firstName = lead.name?.trim().split(/\s+/)[0]
  const textBody = `Hi${firstName ? ` ${firstName}` : ''}, this is QuietGreen. Thanks for asking about ${(s.services.join(', ') || 'lawn care').toLowerCase()}${lead.address ? ` at ${lead.address}` : ''}. When is a good time to talk?`
  const directions = lead.address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(lead.address)}` : null

  const map = (big: boolean) => shapes.length
    ? <TracingMap shapes={shapes} width={big ? 720 : 640} height={big ? 440 : 300} label={`Traced lawn${s.tracedSqFt ? `, ${s.tracedSqFt.toLocaleString('en-US')} sq ft` : ''}`} />
    : mapUrl ? <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="crm-map-shot">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={mapUrl} alt="Map screenshot from the website" /></a>
      : null

  return <LeadLive leadId={lead.id} name={s.name} column={s.column} priceCents={price?.cents ?? null} frequency={price?.frequency ?? normalizeFrequency(lead.frequency)}>
    <QuoteProvider lead={lead as QuoteLead} activities={activities ?? []} bookings={(bookings ?? []) as QuoteBooking[]} customerMatches={customerMatches} quoteUrl={quoteUrl}>
      <div className="crm-workspace crm-lead2">
        <div className="crm-lead2-top">
          <Link className="crm-back" href="/admin/leads"><Icon name="arrowLeft" size={15} />Board</Link>
          <span>{ago(lead.created_at, now)} ago</span>
        </div>
        <div className="crm-lead2-head">
          <div className="crm-lead2-who">
            <h1>{s.name}</h1>
            <p className="crm-lead2-contact">{s.phoneDisplay || '—'}{lead.email && <> · <CopyText text={lead.email} label="email" /></>}</p>
          </div>
          <div className="crm-lead2-actions">
            <a className="crm-button crm-button-primary crm-call" href={`tel:${lead.phone}`}><Icon name="phone" size={17} />Call {s.phoneDisplay}</a>
            <TextLink className="crm-button" phone={lead.phone} body={textBody}><Icon name="message" size={17} />Text</TextLink>
            <LogCallButton className="crm-button crm-desktop-only" />
          </div>
        </div>
        <LeadChips chips={s.chips} />
        {lead.needs_call_log_at && <div className="crm-logcall-banner" role="status">
          <span><Icon name="note" size={16} />Log this call · {historyItem({ kind: 'note', occurred_at: lead.needs_call_log_at }, now).time}</span>
          <LogCallButton className="crm-button crm-button-sm crm-button-primary">Log call</LogCallButton>
        </div>}

        <div className="crm-lead2-grid">
          <div className="crm-lead2-main">
            <Block title="Price" className="crm-o1" aside={price ? `${price.source === 'website' ? 'website' : price.source === 'phone' ? 'phone' : 'emailed'}${dayLabel(price.at) ? ` · ${dayLabel(price.at)}` : ''}` : null}>
              <p className="crm-bignum">{price ? money(price.cents) : '—'}{price && <small>{price.recurring ? `/ visit · ${price.frequency ? FREQUENCY_LABEL[price.frequency] : ''}` : 'total'}</small>}</p>
              <Rows rows={[
                ...(price?.firstVisitCents != null ? [{ label: '1st visit', value: <>{money(price.firstVisitCents)} {price.firstVisitPct && <Pill tone="ok">−{price.firstVisitPct}%</Pill>}</> }] : []),
                ...(price?.planDiscountPct ? [{ label: 'Plan disc.', value: `−${price.planDiscountPct}% ${price.frequency ? FREQUENCY_LABEL[price.frequency] : ''}` }] : []),
                { label: 'Source', value: price ? <Pill>{PRICE_SOURCE_LABEL[price.source]}</Pill> : null },
                { label: 'Booking', value: <>{s.wanted.label && live ? `${s.wanted.label} ` : ''}<Pill tone={s.booking === 'booked' ? 'ok' : s.booking === 'canceled' ? 'bad' : s.booking === 'requested' ? 'warn' : 'neutral'}>{s.bookingLabel}</Pill></> },
                ...(lead.first_visit_on ? [{ label: 'First visit', value: dayLabel(lead.first_visit_on, true) }] : []),
                ...((live?.overgrowth_fee ?? 0) > 0 ? [{ label: 'Cleanup fee', value: money(live!.overgrowth_fee! * 100) }] : []),
              ]} />
            </Block>

            <Block title="Property" className="crm-o2" aside={directions && <a href={directions} target="_blank" rel="noopener noreferrer">Directions ↗</a>}>
              <Rows rows={[
                { label: 'Address', value: <>{lead.address ?? null}{addressChip && <> <Pill tone="warn">{addressChip.label}</Pill></>}{addressChanged && <> <Pill tone="warn">Address changed</Pill></>}</> },
                { label: shapes.length ? 'Traced' : 'Lawn', value: s.tracedSqFt ? `${s.tracedSqFt.toLocaleString('en-US')} sq ft` : null },
              ]} />
              {map(false) && <div className="crm-lead2-thumb">{map(false)}</div>}
            </Block>

            <Block title="Request" className="crm-o3">
              <Rows rows={[
                { label: 'Services', value: <>{s.services.join(', ') || null}{answers.service_unmapped === true && <> <Pill tone="warn">Service unclear</Pill></>}</> },
                { label: 'Frequency', value: normalizeFrequency(lead.frequency) ? FREQUENCY_LABEL[normalizeFrequency(lead.frequency)!] : lead.frequency },
                { label: 'Timing', value: s.wanted.label },
                ...(addonKeys.length ? [{ label: 'Add-ons', value: serviceLabels(addonKeys).join(', ') }] : []),
                ...(live?.lawn_size_bucket ? [{ label: 'Lawn size', value: humanize(live.lawn_size_bucket) }] : []),
                ...s.answers.map(a => ({ label: a.label, value: a.value })),
              ]} />
              {s.notes && <p className="crm-quote-text">&ldquo;{s.notes}&rdquo;</p>}
            </Block>

            <Block title="Source" className="crm-o4">
              <div className="crm-lead-chips">
                <Pill>{s.source.channel}</Pill>
                {s.source.detail && <Pill>{s.source.detail}</Pill>}
                {s.source.conviflo && s.source.channel !== 'ConviFlo form' && <Pill>ConviFlo form</Pill>}
              </div>
            </Block>

            <Block title="History" className="crm-o5">
              <ol className="crm-history">
                {history.map(item => <li key={item.key}>
                  <span className="crm-history-time">{item.time}</span>
                  <Icon name={ICON[item.icon]} size={15} className="crm-history-icon" />
                  <span className="crm-history-text">{item.text}{item.recording && <> <RecordingButton src={item.recording} /></>}
                    {item.quote && <span className="crm-quote-text">&ldquo;{item.quote}&rdquo;</span>}</span>
                </li>)}
                {existing && <li>
                  <span className="crm-history-time" />
                  <Icon name="users" size={15} className="crm-history-icon" />
                  <span className="crm-history-text"><Link href={`/admin/customers/${existing.id}`}>Existing customer · {existing.name ?? phoneDisplay(existing.phone)}</Link></span>
                </li>}
              </ol>
            </Block>

            <Block title="Log call" className="crm-o6">
              <LogCallButton className="crm-button crm-button-lg crm-button-block" />
            </Block>

            <details className="crm-block crm-lead2-details crm-o8">
              <summary>Details</summary>
              <h3>Consent</h3>
              <Rows rows={[
                { label: 'Consent', value: lead.consent == null ? null : lead.consent ? 'Granted' : 'Not granted' },
                { label: 'Time', value: stamp(lead.consented_at) },
                { label: 'Version', value: lead.consent_version },
                { label: 'Text', value: lead.consent_text },
              ]} />
              <h3>Score</h3>
              <Rows rows={[{ label: 'Score', value: lead.score != null ? String(lead.score) : null }, { label: 'Value', value: lead.estimated_value != null ? `$${lead.estimated_value}` : null }]} />
              <h3>Tracking</h3>
              <Rows rows={[...clickIds, ...rawUtm, ...touchRows(firstTouch).map(r => ({ ...r, label: `first · ${r.label}` })), ...touchRows(latestTouch).map(r => ({ ...r, label: `latest · ${r.label}` }))]} />
              {!clickIds.length && !rawUtm.length && !Object.keys(firstTouch).length && <p className="crm-muted">—</p>}
              <h3>Alerts</h3>
              {alerts.map(({ alert, event }) => <div key={alert.id} className="crm-alert-line">
                <span>{alertWords(alert)}</span>
                {alert.provider_sid ? <form action={processLeadAlert.bind(null, lead.id, alert.id, event.id, 'refresh')}><button className="crm-button crm-button-sm">Check</button></form>
                  : ['pending', 'disabled', 'failed'].includes(alert.state) ? <form action={processLeadAlert.bind(null, lead.id, alert.id, event.id, 'retry')}><button className="crm-button crm-button-sm">Retry</button></form> : null}
              </div>)}
              {(calls ?? []).map(call => <div key={call.id} className="crm-alert-line"><span>{callWords(call as Call)} · {stamp(call.created_at)}</span></div>)}
              {!alerts.length && !(calls ?? []).length && <p className="crm-muted">—</p>}
              <h3>Technical</h3>
              <Rows rows={[
                { label: 'Intake', value: lead.source },
                { label: 'Submission', value: lead.external_submission_id },
                { label: 'Form', value: lead.form_version },
                { label: 'Lead ID', value: lead.id },
                { label: 'Short link', value: lead.short_code },
                ...(events ?? []).slice(1).map(event => ({ label: 'Later intake', value: `${event.source} · ${event.submission_id}` })),
              ]} />
            </details>
          </div>

          <aside className="crm-lead2-side">
            {map(true) && <div className="crm-lead2-bigmap">{map(true)}
              <p className="crm-block-head"><span>{lead.address ?? '—'}</span><span>{s.tracedSqFt ? `${s.tracedSqFt.toLocaleString('en-US')} sq ft` : '—'}</span></p></div>}
            <div className="crm-o7"><QuotePanel /></div>
          </aside>
        </div>

        <div className="crm-sticky-actions" aria-label="Quick actions">
          <a className="crm-button crm-button-primary crm-button-lg" href={`tel:${lead.phone}`}><Icon name="phone" size={18} />Call</a>
          <LogCallButton className="crm-button crm-button-lg" />
        </div>
      </div>
      <QuoteMap />
    </QuoteProvider>
  </LeadLive>
}
