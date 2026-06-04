'use server'

import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )
}

export interface BookingData {
  name:              string
  phone:             string
  email:             string
  preferred_date:    string
  address:           string
  sq_ft:             number | null
  frequency:         string
  price_per_visit:   number
  first_visit_price: number
  overgrowth_fee:    number
  last_mow:          string
}

export async function submitBooking(data: BookingData): Promise<{ success: boolean; error?: string }> {
  if (!data.name.trim() || !data.phone.trim()) {
    return { success: false, error: 'Name and phone number are required.' }
  }

  const supabase = getSupabase()
  const { error } = await supabase.from('bookings').insert({
    name:              data.name.trim(),
    phone:             data.phone.trim(),
    email:             data.email.trim() || null,
    preferred_date:    data.preferred_date || null,
    address:           data.address,
    sq_ft:             data.sq_ft,
    frequency:         data.frequency,
    price_per_visit:   data.price_per_visit,
    first_visit_price: data.first_visit_price,
    overgrowth_fee:    data.overgrowth_fee || null,
    last_mow:          data.last_mow,
  })

  if (error) {
    return { success: false, error: 'Something went wrong. Please try again.' }
  }

  // Send notification email
  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const preferredDate = data.preferred_date
      ? new Date(data.preferred_date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
      : 'No preference'

    await resend.emails.send({
      from: 'QuietGreen Bookings <bookings@quietgreen.co>',
      to:   'hello@quietgreen.co',
      subject: `New booking — ${data.name} · ${data.address}`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111c17">
          <div style="background:#1a3a2a;padding:24px 28px;border-radius:12px 12px 0 0">
            <p style="color:#52b788;font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin:0 0 6px">New Booking Request</p>
            <h1 style="color:#fff;font-size:22px;margin:0">${data.name}</h1>
          </div>
          <div style="background:#f7f6f2;padding:24px 28px;border-radius:0 0 12px 12px;border:1px solid #e0ede6;border-top:none">

            <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
              <tr><td style="padding:8px 0;color:#4a5e54;font-size:13px;width:140px">Phone</td><td style="padding:8px 0;font-size:14px;font-weight:500"><a href="tel:${data.phone}" style="color:#1a3a2a">${data.phone}</a></td></tr>
              ${data.email ? `<tr><td style="padding:8px 0;color:#4a5e54;font-size:13px">Email</td><td style="padding:8px 0;font-size:14px;font-weight:500"><a href="mailto:${data.email}" style="color:#1a3a2a">${data.email}</a></td></tr>` : ''}
              <tr><td style="padding:8px 0;color:#4a5e54;font-size:13px">Address</td><td style="padding:8px 0;font-size:14px;font-weight:500">${data.address}</td></tr>
              <tr><td style="padding:8px 0;color:#4a5e54;font-size:13px">Preferred date</td><td style="padding:8px 0;font-size:14px;font-weight:500">${preferredDate}</td></tr>
            </table>

            <div style="background:#fff;border:1px solid #b7e4c7;border-radius:10px;padding:16px 20px;margin-bottom:20px">
              <p style="margin:0 0 10px;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#4a5e54">Quote details</p>
              <table style="width:100%;border-collapse:collapse">
                <tr><td style="padding:5px 0;color:#4a5e54;font-size:13px">Lawn size</td><td style="padding:5px 0;font-size:13px;text-align:right">${data.sq_ft?.toLocaleString()} sq ft</td></tr>
                <tr><td style="padding:5px 0;color:#4a5e54;font-size:13px">Frequency</td><td style="padding:5px 0;font-size:13px;text-align:right">${data.frequency}</td></tr>
                <tr><td style="padding:5px 0;color:#4a5e54;font-size:13px">Ongoing price</td><td style="padding:5px 0;font-size:13px;text-align:right">$${data.price_per_visit}/visit</td></tr>
                ${data.overgrowth_fee ? `<tr><td style="padding:5px 0;color:#4a5e54;font-size:13px">First-visit cleanup</td><td style="padding:5px 0;font-size:13px;text-align:right;color:#c08000">+$${data.overgrowth_fee}</td></tr>` : ''}
                <tr style="border-top:1px solid #e0ede6"><td style="padding:10px 0 5px;font-weight:600;font-size:14px">First visit total</td><td style="padding:10px 0 5px;font-weight:600;font-size:14px;text-align:right">$${data.first_visit_price}</td></tr>
              </table>
            </div>

            <a href="tel:${data.phone}" style="display:block;background:#1a3a2a;color:#fff;text-align:center;padding:13px;border-radius:100px;text-decoration:none;font-size:14px;font-weight:500">
              Call ${data.name.split(' ')[0]} →
            </a>
          </div>
        </div>
      `,
    }).catch(() => {}) // don't fail the booking if email fails
  }

  return { success: true }
}
