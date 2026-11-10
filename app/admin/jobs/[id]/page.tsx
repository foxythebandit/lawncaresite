import { notFound } from 'next/navigation'
import { requireStaff } from '@/lib/staff'
import { adminDb } from '@/lib/supabase/admin'
import { austinDay } from '@/lib/calendar-data'
import { calendarReturnTo, visitReturnHref } from '@/lib/calendar-view'
import type { FirstVisitTerms } from '@/lib/crm-contracts'
import { latestQuoteBooking } from '@/lib/crm-quote-booking'
import { nextScheduleDates, visitMapContext, visitScheduleContext } from '../visit-context'
import VisitDetails from '../VisitDetails'

export default async function VisitPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ returnTo?: string }>
}) {
  const { id } = await params
  const requestedBack = (await searchParams).returnTo
  const returnTo = visitReturnHref(`/admin/jobs/${id}`, typeof requestedBack === 'string' ? requestedBack : undefined)
  await requireStaff(returnTo)
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) notFound()
  const db = adminDb()
  const { data: booking } = await db.from('bookings').select('*').eq('id', id).maybeSingle().throwOnError()
  if (!booking) notFound()

  const today = austinDay()
  const linked = Boolean(booking.customer_id && booking.property_id)
  const [items, payments, agreement, candidates, customers, properties, quoteBookings, map, serviceLabel, firstTerms, lead, labels, phoneMatch] = await Promise.all([
    db.from('job_items').select('kind,description,amount').eq('booking_id', id).order('created_at').order('id').throwOnError(),
    db.from('job_payments').select('id,amount,paid_on,method,provenance').eq('booking_id', id).order('paid_on', { ascending: false }).throwOnError(),
    booking.agreement_id ? db.from('recurring_agreements').select('*').eq('id', booking.agreement_id).maybeSingle().throwOnError() : { data: null },
    !booking.agreement_id && booking.customer_id && booking.property_id
      ? db.from('recurring_agreements').select('*,service_labels(id,name,semantic_key,retired_at)')
        .eq('customer_id', booking.customer_id).eq('property_id', booking.property_id).eq('status', 'active')
        .or(booking.service_label_id ? `service_label_id.is.null,service_label_id.eq.${booking.service_label_id}` : 'id.not.is.null')
        .order('created_at').throwOnError()
      : { data: [] },
    !linked ? db.from('customers').select('id,name,phone').order('name').throwOnError() : { data: [] },
    !linked ? db.from('properties').select('id,customer_id,address').order('address').throwOnError()
      : booking.status === 'pending' ? db.from('properties').select('id,customer_id,address').eq('id', booking.property_id).throwOnError() : { data: [] },
    booking.lead_id ? db.from('bookings').select('id,created_at,accepted_quote_snapshot,creation_operation_id')
      .eq('lead_id', booking.lead_id).or('creation_operation_id.not.is.null,accepted_quote_snapshot->>agreement_id.is.null').order('created_at', { ascending: false }).limit(30).throwOnError() : { data: [] },
    visitMapContext(booking),
    booking.service_label_id && booking.status !== 'completed'
      ? db.from('service_labels').select('name').eq('id', booking.service_label_id).maybeSingle().throwOnError()
      : { data: null },
    booking.status === 'pending' ? db.rpc('crm_first_visit_terms', { p_booking_id: id }).throwOnError() : { data: null },
    booking.status === 'pending' && booking.lead_id
      ? db.from('leads').select('updated_at,customer_id,property_id').eq('id', booking.lead_id).maybeSingle().throwOnError() : { data: null },
    booking.status === 'pending' ? db.from('service_labels').select('id,name,semantic_key').is('retired_at', null).order('name').throwOnError() : { data: [] },
    booking.status === 'pending' ? db.rpc('crm_intro_has_phone_match', { p_phone: booking.phone }).throwOnError() : { data: false },
  ])
  const terms = firstTerms.data as FirstVisitTerms | null
  const hasIntro = Boolean(terms?.mowing && terms.first_items?.some(item => item.kind === 'discount' && Number(item.amount) < 0))
  const customerIds = [...(customers.data ?? []).map(customer => customer.id), booking.customer_id, lead.data?.customer_id]
    .filter((customerId): customerId is string => Boolean(customerId))
  const { data: ineligibleCustomers } = hasIntro && customerIds.length
    ? await db.rpc('crm_intro_ineligible_customers', { p_customer_ids: customerIds }).throwOnError() : { data: [] }
  const active = agreement.data?.status === 'active' ? [agreement.data.id] : []
  const [schedule, nextDates] = await Promise.all([
    visitScheduleContext(agreement.data, booking.occurrence_on ?? today),
    nextScheduleDates([...active, ...(candidates.data ?? []).map(candidate => candidate.id)], today),
  ])
  const { id: bookingId, ...visit } = booking
  return <VisitDetails key={bookingId} bookingId={bookingId} booking={visit} today={today} back={calendarReturnTo(requestedBack, today)}
    agreement={agreement.data} nextScheduleOn={agreement.data ? nextDates.get(agreement.data.id) ?? null : null} {...schedule} serviceLabel={serviceLabel.data?.name}
    customers={customers.data ?? []} properties={properties.data ?? []} candidates={(candidates.data ?? []).map(candidate => ({ ...candidate, nextOn: nextDates.get(candidate.id) }))}
    items={(items.data ?? []).map(item => ({ ...item, kind: item.kind === 'discount' ? 'discount' : 'service', amount: String(item.amount) }))}
    payments={payments.data ?? []} quotedVisit={latestQuoteBooking(quoteBookings.data ?? [])?.id === booking.id}
    firstReview={terms ? { terms, hasIntro, ineligibleCustomers: (ineligibleCustomers ?? []) as string[],
      possiblePhoneMatch: !lead.data?.customer_id && phoneMatch.data === true, leadVersion: lead.data?.updated_at ?? null,
      customerId: booking.customer_id ?? lead.data?.customer_id ?? null, propertyId: booking.property_id ?? lead.data?.property_id ?? null,
      labels: labels.data ?? [] } : undefined}
    {...map} emailConfigured={Boolean(process.env.RESEND_API_KEY)} />
}
