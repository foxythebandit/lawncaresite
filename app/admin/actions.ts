'use server'

import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { Resend } from 'resend'

function h(s: string | null | undefined) {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  )
}

export async function login(_: unknown, formData: FormData) {
  const password = formData.get('password') as string
  if (password !== process.env.ADMIN_PASSWORD) {
    return { error: 'Wrong password.' }
  }
  const jar = await cookies()
  jar.set('qg_admin', process.env.ADMIN_TOKEN!, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  })
  redirect('/admin')
}

export async function logout() {
  const jar = await cookies()
  jar.delete('qg_admin')
  redirect('/admin/login')
}

export async function updateStatus(id: string, status: string) {
  const db = getAdmin()
  const { data: booking } = await db.from('bookings').select('*').eq('id', id).single()
  await db.from('bookings').update({ status }).eq('id', id)
  revalidatePath('/admin')

  if (!booking?.email || !process.env.RESEND_API_KEY) return

  const resend = new Resend(process.env.RESEND_API_KEY)
  const firstName = booking.name.split(' ')[0]
  const preferredDate = booking.preferred_date
    ? new Date(booking.preferred_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    : null

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
            ${preferredDate ? `
            <div style="background:#fff;border:1px solid #b7e4c7;border-radius:10px;padding:14px 18px;margin-bottom:20px">
              <p style="margin:0;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#4a5e54">Scheduled for</p>
              <p style="margin:6px 0 0;font-size:18px;font-weight:600;color:#1a3a2a">${h(preferredDate)}</p>
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
            <p style="font-size:13px;color:#4a5e54;margin:0">Questions? Reply to this email or text us any time.</p>
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

export async function getBookings() {
  const { data } = await getAdmin()
    .from('bookings')
    .select('*')
    .order('created_at', { ascending: false })
  return data ?? []
}
