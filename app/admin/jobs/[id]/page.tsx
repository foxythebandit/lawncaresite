import { notFound } from 'next/navigation'
import { requireStaff } from '@/lib/staff'
import { adminDb } from '@/lib/supabase/admin'
import { austinDay } from '@/lib/calendar-data'
import { calendarReturnTo } from '@/lib/calendar-view'
import { latestQuoteBooking } from '@/lib/crm-quote-booking'
import { visitMapContext, visitScheduleContext } from '../visit-context'
import VisitDetails from '../VisitDetails'

export default async function VisitPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ returnTo?: string }>
}) {
  const { id } = await params
  await requireStaff(`/admin/jobs/${id}`)
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) notFound()
  const db = adminDb()
  const { data: booking } = await db.from('bookings').select('*').eq('id', id).maybeSingle().throwOnError()
  if (!booking) notFound()

  const today = austinDay()
  const linked = Boolean(booking.customer_id && booking.property_id)
  const [items, payments, agreement, candidates, customers, properties, quoteBookings, map] = await Promise.all([
    db.from('job_items').select('kind,description,amount').eq('booking_id', id).order('created_at').order('id').throwOnError(),
    db.from('job_payments').select('id,amount,paid_on,method,provenance').eq('booking_id', id).order('paid_on', { ascending: false }).throwOnError(),
    booking.agreement_id ? db.from('recurring_agreements').select('*').eq('id', booking.agreement_id).maybeSingle().throwOnError() : { data: null },
    !booking.agreement_id && booking.customer_id && booking.property_id
      ? db.from('recurring_agreements').select('id,interval_count,interval_unit,price_per_visit,next_on')
        .eq('customer_id', booking.customer_id).eq('property_id', booking.property_id).eq('status', 'active').order('created_at').throwOnError()
      : { data: [] },
    !linked ? db.from('customers').select('id,name,phone').order('name').throwOnError() : { data: [] },
    !linked ? db.from('properties').select('id,customer_id,address').order('address').throwOnError() : { data: [] },
    booking.lead_id ? db.from('bookings').select('id,created_at,accepted_quote_snapshot,creation_operation_id')
      .eq('lead_id', booking.lead_id).or('creation_operation_id.not.is.null,accepted_quote_snapshot->>agreement_id.is.null').order('created_at', { ascending: false }).limit(30).throwOnError() : { data: [] },
    visitMapContext(booking),
  ])
  const schedule = await visitScheduleContext(agreement.data, today)
  const { id: bookingId, ...visit } = booking
  return <VisitDetails key={bookingId} bookingId={bookingId} booking={visit} today={today} back={calendarReturnTo((await searchParams).returnTo, today)}
    agreement={agreement.data} {...schedule}
    customers={customers.data ?? []} properties={properties.data ?? []} candidates={candidates.data ?? []}
    items={(items.data ?? []).map(item => ({ ...item, kind: item.kind === 'discount' ? 'discount' : 'service', amount: String(item.amount) }))}
    payments={payments.data ?? []} quotedVisit={latestQuoteBooking(quoteBookings.data ?? [])?.id === booking.id}
    {...map} emailConfigured={Boolean(process.env.RESEND_API_KEY)} />
}
