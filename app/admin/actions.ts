'use server'

import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { Resend } from 'resend'
import Stripe from 'stripe'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ALLOWED_STATUSES = new Set(['pending', 'confirmed', 'declined', 'completed'])

function h(s: string | null | undefined) {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  )
}

// Simple per-process rate limiter (slows brute force; not cross-instance)
const loginAttempts = new Map<string, { count: number; resetAt: number }>()
const RATE_WINDOW_MS = 15 * 60 * 1000 // 15 min
const MAX_ATTEMPTS   = 10

export async function login(_: unknown, formData: FormData) {
  const password = formData.get('password') as string
  const key = 'admin'
  const now = Date.now()
  const rec = loginAttempts.get(key)

  if (rec && now < rec.resetAt && rec.count >= MAX_ATTEMPTS) {
    await new Promise(r => setTimeout(r, 2000))
    return { error: 'Too many attempts. Try again later.' }
  }

  if (password !== process.env.ADMIN_PASSWORD) {
    const entry = rec && now < rec.resetAt ? rec : { count: 0, resetAt: now + RATE_WINDOW_MS }
    entry.count++
    loginAttempts.set(key, entry)
    await new Promise(r => setTimeout(r, 800)) // slow brute force
    return { error: 'Incorrect password.' }
  }

  loginAttempts.delete(key)
  const jar = await cookies()
  jar.set('qg_admin', process.env.ADMIN_TOKEN!, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 60 * 60 * 8, // 8 hours
    path: '/',
  })
  redirect('/admin')
}

export async function logout() {
  const jar = await cookies()
  jar.delete('qg_admin')
  redirect('/admin/login')
}

export async function updateNotes(id: string, notes: string) {
  if (!UUID_RE.test(id)) return
  await getAdmin().from('bookings').update({ notes: notes.slice(0, 2000) }).eq('id', id)
  revalidatePath('/admin')
}

export async function deleteBooking(id: string) {
  if (!UUID_RE.test(id)) return
  await getAdmin().from('bookings').delete().eq('id', id)
  revalidatePath('/admin')
}

export async function updateStatus(id: string, status: string, confirmedDate?: string, confirmedTime?: string) {
  if (!UUID_RE.test(id) || !ALLOWED_STATUSES.has(status)) return
  const db = getAdmin()
  const { data: booking } = await db.from('bookings').select('*').eq('id', id).single()
  const update: Record<string, unknown> = { status }
  if (confirmedDate) update.confirmed_date = confirmedDate
  if (confirmedTime) update.confirmed_time = confirmedTime
  await db.from('bookings').update(update).eq('id', id)
  revalidatePath('/admin')

  if (!booking?.email || !process.env.RESEND_API_KEY) return

  const resend = new Resend(process.env.RESEND_API_KEY)
  const firstName = booking.name.split(' ')[0]
  const scheduledDate = confirmedDate
    ? new Date(confirmedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    : booking.preferred_date
      ? new Date(booking.preferred_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
      : null
  const scheduledTime = confirmedTime ?? booking.confirmed_time ?? null

  if (status === 'confirmed') {
    await resend.emails.send({
      from: 'QuietGreen <hello@quietgreen.co>',
      to: booking.email,
      subject: 'Your QuietGreen visit is confirmed ✓',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#111c17">
          <div style="background:#1a3a2a;padding:24px 28px;border-radius:12px 12px 0 0">
            <p style="color:#52b788;font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin:0 0 6px">Booking Confirmed</p>
            <h1 style="color:#fff;font-size:22px;margin:0">You're on the schedule, ${h(firstName)}.</h1>
          </div>
          <div style="background:#f7f6f2;padding:24px 28px;border-radius:0 0 12px 12px;border:1px solid #e0ede6;border-top:none">
            <p style="font-size:15px;line-height:1.6;color:#4a5e54;margin:0 0 20px">
              Your QuietGreen visit has been confirmed. We'll arrive quietly, get it done, and be out of your hair — no fumes, no noise.
            </p>
            ${scheduledDate ? `
            <div style="background:#fff;border:1px solid #b7e4c7;border-radius:10px;padding:14px 18px;margin-bottom:20px">
              <p style="margin:0;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#4a5e54">Scheduled for</p>
              <p style="margin:6px 0 0;font-size:18px;font-weight:600;color:#1a3a2a">${h(scheduledDate)}${scheduledTime ? ` at ${h(scheduledTime)}` : ''}</p>
            </div>` : ''}
            <div style="background:#fff;border:1px solid #e0ede6;border-radius:10px;padding:14px 18px;margin-bottom:20px;font-size:13px;color:#4a5e54">
              <p style="margin:0 0 4px">${h(booking.address)}</p>
              <p style="margin:0">${booking.sq_ft?.toLocaleString()} sq ft · ${h(booking.frequency)} · $${booking.price_per_visit}/visit</p>
              ${booking.overgrowth_fee ? `<p style="margin:6px 0 0;color:#b07800">First visit $${booking.first_visit_price} (incl. $${booking.overgrowth_fee} first-cut cleanup)</p>` : ''}
            </div>
            ${booking.map_screenshot_url ? `
            <div style="margin-bottom:20px">
              <p style="margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#4a5e54">Your traced lawn</p>
              <img src="${booking.map_screenshot_url}" alt="Your lawn trace" style="width:100%;border-radius:10px;border:1px solid #e0ede6;display:block"/>
            </div>` : ''}
            <div style="background:#fff;border:1px solid #e0ede6;border-radius:10px;padding:12px 16px;margin-bottom:20px;font-size:13px;color:#4a5e54">
              <strong style="color:#1a3a2a">Payment:</strong> You won't be charged today. An invoice will be sent to this email address once the job is complete.
            </div>
            <p style="font-size:13px;color:#4a5e54;margin:0">Questions? Reply to this email or email us any time.</p>
          </div>
        </div>
      `,
    }).catch(() => {})
  }

  if (status === 'declined') {
    await resend.emails.send({
      from: 'QuietGreen <hello@quietgreen.co>',
      to: booking.email,
      subject: 'Re: Your QuietGreen quote request',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#111c17">
          <div style="background:#1a3a2a;padding:24px 28px;border-radius:12px 12px 0 0">
            <h1 style="color:#fff;font-size:22px;margin:0">Hi ${h(firstName)},</h1>
          </div>
          <div style="background:#f7f6f2;padding:24px 28px;border-radius:0 0 12px 12px;border:1px solid #e0ede6;border-top:none">
            <p style="font-size:15px;line-height:1.6;color:#4a5e54;margin:0 0 16px">
              Thanks for reaching out to QuietGreen. Unfortunately we're not able to take on your visit at this time — we may be fully booked in your area or outside our current service zone.
            </p>
            <p style="font-size:15px;line-height:1.6;color:#4a5e54;margin:0 0 20px">
              If you'd like to stay on our waitlist or discuss alternatives, just reply to this email and we'll get back to you.
            </p>
            <p style="font-size:13px;color:#4a5e54;margin:0">— The QuietGreen team</p>
          </div>
        </div>
      `,
    }).catch(() => {})
  }
}

export async function markComplete(
  id: string,
  data: { completed_at: string; amount_charged: number; payment_method: string }
) {
  if (!UUID_RE.test(id)) return
  const db = getAdmin()
  const { data: booking } = await db.from('bookings').select('*').eq('id', id).single()
  if (!booking) return

  const base = new Date(data.completed_at)
  const freq = (booking.frequency ?? '').toLowerCase()
  const days = freq.includes('bi') ? 14 : freq.includes('month') ? 30 : 7
  const nextDate = new Date(base)
  nextDate.setDate(nextDate.getDate() + days)
  const nextVisitDate = nextDate.toISOString().split('T')[0]

  await db.from('bookings').update({
    status: 'completed',
    completed_at: data.completed_at,
    amount_charged: data.amount_charged,
    payment_method: data.payment_method,
    next_visit_date: nextVisitDate,
  }).eq('id', id)

  await db.from('bookings').insert({
    name: booking.name,
    phone: booking.phone,
    email: booking.email,
    address: booking.address,
    sq_ft: booking.sq_ft,
    frequency: booking.frequency,
    price_per_visit: booking.price_per_visit,
    first_visit_price: booking.price_per_visit,
    overgrowth_fee: null,
    last_mow: data.completed_at,
    map_screenshot_url: booking.map_screenshot_url,
    preferred_date: nextVisitDate,
    confirmed_date: nextVisitDate,
    confirmed_time: booking.confirmed_time ?? null,
    status: 'confirmed',
    notes: `Auto-scheduled. Previous visit ${data.completed_at.split('T')[0]}.`,
  })

  revalidatePath('/admin')
}

export async function getBookings() {
  const { data } = await getAdmin()
    .from('bookings')
    .select('*')
    .order('created_at', { ascending: false })
  return data ?? []
}

export async function getLeads() {
  const { data } = await getAdmin()
    .from('leads')
    .select('*')
    .order('created_at', { ascending: false })
  return data ?? []
}

export async function deleteLead(id: string) {
  if (!UUID_RE.test(id)) return
  await getAdmin().from('leads').delete().eq('id', id)
  revalidatePath('/admin/leads')
}

export async function createPaymentLink(
  bookingId: string,
  amountDollars: number,
  customerName: string,
  address: string,
): Promise<{ url: string } | { error: string }> {
  if (!UUID_RE.test(bookingId)) return { error: 'Invalid booking ID' }
  if (!process.env.STRIPE_SECRET_KEY) return { error: 'Stripe not configured' }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
  const amountCents = Math.round(amountDollars * 100)

  try {
    const price = await stripe.prices.create({
      currency: 'usd',
      unit_amount: amountCents,
      product_data: {
        name: `QuietGreen lawn service — ${address}`,
      },
    })

    const link = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: { booking_id: bookingId, customer_name: customerName },
    })

    await getAdmin().from('bookings').update({ payment_link: link.url }).eq('id', bookingId)

    return { url: link.url }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return { error: msg }
  }
}
