import { formatPhone } from '@/lib/format-phone'
import { formatMoney, formatMoneyWhole, jobPrice, jobStatusLabel } from '@/lib/crm-jobs'
import { getBookings } from '../../actions'
import Link from 'next/link'
import ReminderButtons from '../../ReminderButtons'
import Icon from '../../icons'

function formatDate(s: string) {
  return new Date(s.slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  })
}

export default async function ClientPage({ params }: { params: Promise<{ phone: string }> }) {
  const { phone: raw } = await params
  const phone = decodeURIComponent(raw)
  const all   = await getBookings()

  const visits = all
    .filter(b => b.phone === phone && !b.customer_id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))

  if (visits.length === 0) {
    return (
      <div className="crm-page">
        <Link href="/admin" className="crm-back"><Icon name="arrowLeft" size={15} />Jobs</Link>
        <div className="admin-empty">No unlinked legacy visits found for this phone.</div>
      </div>
    )
  }

  const client    = visits[0]
  const completed = visits.filter(b => b.status === 'completed')
  const legacyRecorded = completed.reduce((s, b) => s + (b.amount_charged ?? 0), 0)
  const nextVisit  = visits.find(b => b.status === 'confirmed' && b.confirmed_date)

  return (
    <div className="crm-page">
      <Link href="/admin" className="crm-back"><Icon name="arrowLeft" size={15} />Jobs</Link>
      <div className="crm-page-heading">
        <div>
          <h1>{client.name}</h1>
          <p className="crm-muted">{formatPhone(client.phone)}{client.email ? ` · ${client.email}` : ''}</p>
          <p className="crm-muted">{client.address}{client.sq_ft ? ` · ${client.sq_ft.toLocaleString()} sq ft` : ''}{client.frequency ? ` · ${client.frequency}` : ''}</p>
        </div>
        <div className="crm-head-actions">
          {client.email && <a className="crm-button" href={`mailto:${client.email}`}><Icon name="mail" size={15} />Email</a>}
          <a className="crm-button crm-button-primary" href={`tel:${client.phone}`}><Icon name="phone" size={15} />Call</a>
        </div>
      </div>
      <p className="crm-customer-help">Unlinked legacy visits sharing this phone. Review identity before linking customer history.</p>

      <div className="admin-stats">
        <div className="admin-stat">
          <span className="admin-stat-val">{visits.length}</span>
          <span className="admin-stat-label">Total visits</span>
        </div>
        <div className="admin-stat">
          <span className="admin-stat-val">{completed.length}</span>
          <span className="admin-stat-label">Completed</span>
        </div>
        <div className="admin-stat">
          <span className="admin-stat-val">{formatMoneyWhole(legacyRecorded)}</span>
          <span className="admin-stat-label">Legacy amount recorded</span>
        </div>
        {nextVisit?.confirmed_date && (
          <div className="admin-stat">
            <span className="admin-stat-val" style={{ fontSize: 16 }}>{formatDate(nextVisit.confirmed_date)}</span>
            <span className="admin-stat-label">Next visit</span>
          </div>
        )}
      </div>

      {nextVisit?.confirmed_date && (
        <section className="crm-panel" style={{ marginBottom: 16 }}>
          <h2>Next visit reminder</h2>
          <ReminderButtons
            bookingId={nextVisit.id}
            name={nextVisit.name}
            phone={nextVisit.phone}
            email={nextVisit.email}
            confirmedDate={nextVisit.confirmed_date}
            confirmedTime={nextVisit.confirmed_time}
            lastReminderSentAt={nextVisit.last_reminder_sent_at}
          />
        </section>
      )}

      <section className="crm-panel">
        <h2>Visit history</h2>
        {visits.map(b => {
          const dateStr = (b.completed_at ?? b.confirmed_date ?? b.preferred_date ?? b.created_at).slice(0, 10)
          return (
            <div key={b.id} className="admin-client-visit">
              <div className="admin-client-visit-date">{formatDate(dateStr)}</div>
              <div className="admin-client-visit-info">
                <span className={`admin-badge admin-badge-${b.status}`}>{jobStatusLabel(b.status)}</span>
                {b.frequency && <span className="admin-client-visit-freq">{b.frequency}</span>}
                {b.notes && <span className="admin-client-visit-note" title={b.notes}>{b.notes}</span>}
              </div>
              <div className="admin-client-visit-right">
                {b.amount_charged != null
                  ? <strong>{formatMoney(b.amount_charged)}</strong>
                  : (b.job_total ?? b.first_visit_price ?? b.price_per_visit) != null
                  ? <span>{formatMoney(jobPrice(b))}</span>
                  : null}
                {b.payment_method && <small>{b.payment_method}</small>}
              </div>
            </div>
          )
        })}
      </section>
    </div>
  )
}
