import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { adminDb } from '@/lib/supabase/admin'
import { jobPrice } from '@/lib/crm-jobs'
import { signedMapUrl } from '@/lib/map-screenshot'

function formatDate(s: string) {
  return new Date(s + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })
}

function formatTime(t: string) {
  if (!/^\d{1,2}:\d{2}$/.test(t)) return t // "Morning" / "Afternoon" — pass through as-is
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

function timeAgo(s: string) {
  const diff = Date.now() - new Date(s).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days} days ago`
}

export default async function PortalPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/portal/login')

  const { data: bookings } = await supabase
    .from('bookings')
    .select('id, email, created_at, status, confirmed_date, preferred_date, confirmed_time, address, sq_ft, frequency, price_per_visit, job_total, map_screenshot_url, completed_at, amount_charged, payment_method, payment_link')
    .order('created_at', { ascending: false })

  const visits = bookings ?? []
  // Only IDs already authorized by the customer's booking RLS may reach this lookup.
  // Keep payment provenance/operations private; render aggregate amounts only.
  const { data: payments, error: paymentError } = visits.length
    ? await adminDb().from('job_payments').select('booking_id,amount').in('booking_id', visits.map(visit => visit.id))
    : { data: [], error: null }
  const { data: priceTerms, error: priceError } = visits.length
    ? await adminDb().from('bookings').select('id,first_visit_price').in('id', visits.map(visit => visit.id))
    : { data: [], error: null }
  const firstVisitByJob = new Map((priceTerms ?? []).map(row => [row.id, row.first_visit_price]))
  function visitPrice(visit: typeof visits[number]) {
    if (visit.job_total == null && priceError) return null
    const first_visit_price = firstVisitByJob.get(visit.id)
    if ((visit.job_total ?? first_visit_price ?? visit.price_per_visit) == null) return null
    return jobPrice({ ...visit, first_visit_price })
  }
  const paidByJob = new Map<string, number>()
  for (const payment of payments ?? []) paidByJob.set(payment.booking_id,
    (paidByJob.get(payment.booking_id) ?? 0) + Number(payment.amount))

  const upcoming = visits.find(b =>
    b.status === 'confirmed' && (b.confirmed_date || b.preferred_date)
  )
  // The map bucket is private (P7); a short-lived signed link, or no image if signing fails.
  const upcomingMap = upcoming ? await signedMapUrl(upcoming.map_screenshot_url, 3600) : null
  const history = visits.filter(b => b.status === 'completed')
  const pending  = visits.filter(b => b.status === 'pending')

  async function signOut() {
    'use server'
    const sb = await createClient()
    await sb.auth.signOut()
    redirect('/portal/login')
  }

  return (
    <div className="portal-body">

      {visits.length === 0 ? (
        <div className="portal-empty">
          <div className="portal-empty-icon">🌱</div>
          <h2>No bookings found</h2>
          <p>We couldn't find any bookings for <strong>{user.email}</strong>. Make sure you're using the same email you booked with.</p>
          <a href="/#quote" className="portal-cta">Get a quote</a>
        </div>
      ) : (
        <>
          {/* Upcoming visit */}
          {upcoming ? (
            <div className="portal-upcoming">
              <div className="portal-upcoming-label">Your next visit</div>
              <div className="portal-upcoming-date">
                {formatDate(upcoming.confirmed_date ?? upcoming.preferred_date)}
                {upcoming.confirmed_time && (
                  <span className="portal-upcoming-time"> · {formatTime(upcoming.confirmed_time)}</span>
                )}
              </div>
              <div className="portal-upcoming-detail">
                {upcoming.address} · {upcoming.sq_ft?.toLocaleString()} sq ft · {upcoming.frequency}
              </div>
              <div className="portal-upcoming-price">
                {visitPrice(upcoming) != null
                  ? <>${visitPrice(upcoming)!.toFixed(2)}<span>/visit</span></>
                  : 'Price not set'}
              </div>
              {upcomingMap && (
                <img src={upcomingMap} alt="Your lawn" className="portal-upcoming-map" />
              )}
            </div>
          ) : pending.length > 0 ? (
            <div className="portal-pending-notice">
              <div className="portal-pending-icon">⏳</div>
              <div>
                <strong>Booking received</strong> — we're reviewing your request and will confirm shortly.
              </div>
            </div>
          ) : null}

          {/* Visit history */}
          {history.length > 0 && (
            <div className="portal-section">
              <div className="portal-section-title">Visit history</div>
              {history.map(b => {
                const paid = paidByJob.get(b.id)
                const total = visitPrice(b)
                const remaining = total == null || paid == null ? null : Math.max(0, Math.round((Number(total) - paid) * 100) / 100)
                return (
                <div key={b.id} className="portal-visit">
                  <div className="portal-visit-date">
                    {formatDate((b.completed_at ?? b.confirmed_date ?? b.created_at).slice(0, 10))}
                    <span className="portal-visit-ago">{timeAgo(b.completed_at ?? b.created_at)}</span>
                  </div>
                  <div className="portal-visit-right">
                    {paid !== undefined && b.amount_charged != null && <span className="portal-visit-method">Earlier amount recorded: ${b.amount_charged.toFixed(2)} · not reconciled with payments below</span>}
                    {paymentError ? <span className="portal-visit-method">Payment status unavailable. Please contact us.</span>
                      : paid !== undefined ? <>
                        <span className="portal-visit-amount">${paid.toFixed(2)} paid</span>
                        <span className="portal-visit-method">{remaining === 0 ? 'Paid in full' : b.amount_charged != null ? 'Please contact us to confirm the remaining balance.' : remaining === null ? 'Payment recorded' : `$${remaining.toFixed(2)} remaining · Contact us to arrange payment`}</span>
                      </> : <>
                        {b.amount_charged != null && <span className="portal-visit-amount">${b.amount_charged.toFixed(2)}</span>}
                        {b.payment_method ? <span className="portal-visit-method">Paid · {b.payment_method}</span>
                          : b.payment_link ? <a href={b.payment_link} target="_blank" rel="noopener noreferrer" className="portal-pay-btn">Pay now</a> : null}
                      </>}
                  </div>
                </div>
              )})}
            </div>
          )}

          {/* Contact */}
          <div className="portal-section portal-contact">
            <a href="sms:+16823528260" className="portal-contact-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              Text us
            </a>
            <a href="mailto:hello@quietgreen.co" className="portal-contact-btn portal-contact-btn-outline">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
              Email us
            </a>
          </div>
        </>
      )}

      <form action={signOut} style={{ textAlign: 'center', paddingBottom: 32 }}>
        <button type="submit" className="portal-signout">Sign out</button>
      </form>
    </div>
  )
}
