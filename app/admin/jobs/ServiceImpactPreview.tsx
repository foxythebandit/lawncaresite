import Link from 'next/link'
import { visitTime } from '@/lib/calendar-view'
import { formatMoney } from '@/lib/crm-jobs'
import { serviceDate, type Cadence, type ServicePreview } from '@/lib/service-schedules'

const LABELS: Record<ServicePreview['changes'][number]['action'], string> = {
  keep: 'Keep saved visit', cancel: 'Cancel and keep in history', restore: 'Restore visit',
  update: 'Follow the reviewed schedule', extra: 'Keep as an individual visit', conflict: 'Needs a decision',
  move: 'Move visit', tombstone: 'Keep skipped or canceled',
}

export default function ServiceImpactPreview({ preview, rules = [], moving = false }: {
  preview: ServicePreview; rules?: Cadence[]; moving?: boolean
}) {
  const monthlyGaps = rules.some(rule => rule.frequency === 'monthly'
    && ((rule.pattern === 'day' && rule.day > 28) || (rule.pattern === 'ordinal' && rule.ordinal === 5)))
  const changes = preview.changes.filter(item => moving || item.action !== 'update' || item.price !== item.old_price)
  const dates = preview.dates.slice(0, 8)
  const dateRow = (item: ServicePreview['dates'][number]) => <li key={item.on}>
    <span>{serviceDate(item.on)} · {visitTime(item.arrival) || 'Any time'}</span><strong>{formatMoney(item.price)}</strong>
  </li>
  return <section className="service-editor-review" aria-labelledby="service-preview-heading">
    <h2 id="service-preview-heading" tabIndex={-1}>Review before saving</h2>
    {preview.first_on && <p><strong>{moving ? 'Selected visit' : 'First visit'}</strong> {serviceDate(preview.first_on)} · {visitTime(preview.first_arrival) || 'Any time'} · {formatMoney(preview.first_price)}</p>}
    {preview.intro_continuation && <p>The first visit uses the saved introductory price. Later visits use the new agreed price of {formatMoney(preview.intro_continuation.regular_price)}.</p>}
    {preview.intro_transfer?.to_on && <p>The saved introductory price moves to {serviceDate(preview.intro_transfer.to_on)}
      {' · '}{formatMoney(preview.intro_transfer.standard_price)} → {formatMoney(preview.intro_transfer.intro_price)}.</p>}
    {preview.intro_transfer?.needs_review && <p className="service-editor-notice">Review the saved items and payment links before moving the unused introductory price. It stays with its current visit.</p>}
    {preview.same_day_extra && <p>A regular visit already falls on this date. Saving adds a separate visit.</p>}
    {monthlyGaps && <p className="service-editor-notice">Months without that day or fifth weekday are skipped. Choose Last day of month or Last weekday for a visit every month.</p>}
    {preview.dates.length > 0 && <>
      <h3>Upcoming dates and prices</h3>
      <ol className="service-preview-list">{dates.map(dateRow)}</ol>
      {preview.dates.length > dates.length && <details><summary>Show {preview.dates.length - dates.length} more preview dates</summary>
        <ol className="service-preview-list">{preview.dates.slice(dates.length).map(dateRow)}</ol>
      </details>}
    </>}
    {!preview.dates.length && !preview.first_on && <p>No regular visits in the reviewed period.</p>}
    {changes.length > 0 && <>
      <h3>Saved visits affected</h3>
      <ul className="service-preview-list">{changes.map(change => <li key={change.booking_id ?? change.on}>
        <span>{change.old_on && change.old_on !== change.on ? `${serviceDate(change.old_on)} → ` : ''}
          {change.booking_id ? <Link href={`/admin/jobs/${change.booking_id}`}>{serviceDate(change.on)}</Link> : serviceDate(change.on)}
          {' · '}{LABELS[change.action]}{moving && change.action === 'update' && ` · ${visitTime(change.arrival) || 'Any time'}`}</span>
        {change.price != null && <strong>{change.old_price !== change.price && change.old_price != null
          ? `${formatMoney(change.old_price)} → ` : ''}{formatMoney(change.price)}</strong>}
      </li>)}</ul>
    </>}
    {preview.conflicts.length > 0 && <div className="work-visit-error" role="alert">
      <p>Resolve the listed visits before saving. Paid visits stay on the calendar.</p>
      {preview.conflicts.filter(conflict => conflict.action === 'collision').map(conflict =>
        <p key={conflict.on}>A saved visit overlaps the regular date on {serviceDate(conflict.on)}.</p>)}
    </div>}
  </section>
}

