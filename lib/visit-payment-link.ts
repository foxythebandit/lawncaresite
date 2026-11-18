// lib-ok: Both saved and projected visits use the same Stripe payment link and version check.
import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'
import type { Database } from '@/supabase/database.types'
import { jobPrice, moneyCents } from './crm-jobs'

export type PreparedVisit = { operationId: string; updatedAt: string; preparedAt: string }

// Stripe and Resend retain keys for at least 24 hours. Leave room for a request to reach the provider.
export const providerRetryExpired = (prepared: PreparedVisit) => Date.now() - Date.parse(prepared.preparedAt) >= 23 * 60 * 60 * 1000

export async function saveVisitPaymentLink(db: SupabaseClient<Database>, stripe: Pick<Stripe, 'prices' | 'paymentLinks'>,
  bookingId: string, prepared?: PreparedVisit): Promise<{ url: string } | { error: string }> {
  const { data: booking, error: readError } = await db.from('bookings')
    .select('id,name,address,job_total,first_visit_price,price_per_visit,status,updated_at,payment_link').eq('id', bookingId).single()
  if (readError || !booking) return { error: 'Job not found.' }
  if (!['confirmed','completed'].includes(booking.status)) return { error: 'Confirm the visit first.' }
  if (prepared) {
    if (booking.payment_link) return { url: booking.payment_link }
    if (booking.updated_at !== prepared.updatedAt || providerRetryExpired(prepared)) {
      return { error: 'Reopen the saved visit and review its price before creating a payment link.' }
    }
  }
  const amountCents = moneyCents(jobPrice(booking).toFixed(2))
  if (amountCents <= 0) return { error: 'Set a positive job total first.' }

  try {
    const price = await stripe.prices.create({
      currency: 'usd',
      unit_amount: amountCents,
      product_data: {
        name: `QuietGreen service — ${booking.address}`,
      },
    }, prepared ? { idempotencyKey: `visit-price/${prepared.operationId}` } : undefined)

    const link = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: { booking_id: bookingId, customer_name: booking.name },
    }, prepared ? { idempotencyKey: `visit-link/${prepared.operationId}` } : undefined)

    const { data: saved, error: saveError } = await db.from('bookings')
      .update({ payment_link: link.url }).eq('id', bookingId)
      .eq('updated_at', booking.updated_at).select('id').maybeSingle()
    if (saveError || !saved) return { error: 'Job changed while creating the link. Refresh and review its current total.' }

    return { url: link.url }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return { error: msg }
  }
}
