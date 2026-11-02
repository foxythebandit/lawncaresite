import { adminDb } from '@/lib/supabase/admin'
import { feedAuthorized } from '@/lib/google-ads-feed'
import { conversionCsv, conversionRows, paidVisits } from '@/lib/google-ads-revenue'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Paid visits credited to Google ad clicks, as a Google Ads offline-conversion CSV. */
export async function GET(request: Request) {
  if (!feedAuthorized(request.headers.get('authorization'))) {
    return new Response('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="google-ads-feed"' } })
  }
  const db = adminDb()
  const [jobs, payments] = await Promise.all([
    db.from('bookings').select('id,name,phone,created_at,status,customer_id,agreement_id,one_time,frequency,gclid,attribution,amount_charged,completed_at,payment_recorded_at'),
    db.from('job_payments').select('booking_id,amount,paid_on'),
  ])
  if (jobs.error || payments.error) return new Response('Unavailable', { status: 503 })
  const csv = conversionCsv(conversionRows(paidVisits(jobs.data ?? [], payments.data ?? [])))
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' } })
}
