'use server'

import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { formatAttributionLabel, type Attribution } from '@/lib/attribution'

export interface ManualQuoteData extends Attribution {
  name:            string
  phone:           string
  address:         string
  lawn_size_bucket?: string
}

function h(s: string | null | undefined) {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export async function submitManualQuote(data: ManualQuoteData): Promise<{ success: boolean; error?: string }> {
  if (!data.name.trim() || !data.phone.trim() || !data.address.trim()) {
    return { success: false, error: 'Please fill in your name, phone, and address.' }
  }

  // Service-role client — same reason as submit-booking.ts: the public/anon
  // client can insert under RLS but can't .select() the row back.
  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  )

  const { data: inserted, error } = await adminClient.from('bookings').insert({
    name:              data.name.trim(),
    phone:             data.phone.trim(),
    address:           data.address.trim(),
    manual_quote:      true,
    lawn_size_bucket:  data.lawn_size_bucket || null,
    status:            'pending',
    gclid:             data.gclid || null,
    utm_source:        data.utm_source || null,
    utm_medium:        data.utm_medium || null,
    utm_campaign:      data.utm_campaign || null,
    utm_term:          data.utm_term || null,
    utm_content:       data.utm_content || null,
  }).select('id').single()

  if (error) {
    return { success: false, error: 'Something went wrong. Please try again.' }
  }

  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const source = formatAttributionLabel(data)

    await resend.emails.send({
      from: 'QuietGreen Leads <onboarding@resend.dev>',
      to: 'paxonearth.22@gmail.com',
      subject: `New manual quote request — ${data.name}`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#111c17">
          <div style="background:#1a3a2a;padding:20px 24px;border-radius:12px 12px 0 0">
            <p style="color:#52b788;font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin:0">Manual Quote Request</p>
            <h1 style="color:#fff;font-size:20px;margin:6px 0 0">${h(data.name)}</h1>
          </div>
          <div style="background:#f7f6f2;padding:20px 24px;border-radius:0 0 12px 12px;border:1px solid #e0ede6;border-top:none">
            <table style="width:100%;border-collapse:collapse;margin-bottom:12px">
              <tr><td style="padding:6px 0;color:#4a5e54;font-size:13px;width:100px">Phone</td><td style="padding:6px 0;font-size:14px;font-weight:500"><a href="tel:${h(data.phone)}" style="color:#1a3a2a">${h(data.phone)}</a></td></tr>
              <tr><td style="padding:6px 0;color:#4a5e54;font-size:13px">Address</td><td style="padding:6px 0;font-size:14px;font-weight:500">${h(data.address)}</td></tr>
              ${data.lawn_size_bucket ? `<tr><td style="padding:6px 0;color:#4a5e54;font-size:13px">Lawn size</td><td style="padding:6px 0;font-size:14px;font-weight:500">${h(data.lawn_size_bucket)}</td></tr>` : ''}
              ${source ? `<tr><td style="padding:6px 0;color:#4a5e54;font-size:13px">Source</td><td style="padding:6px 0;font-size:14px;font-weight:500">${h(source)}</td></tr>` : ''}
            </table>
            <p style="margin:0;color:#8a978f;font-size:12px">They skipped the map tool — measure and quote this one manually, then confirm from the admin panel.</p>
          </div>
        </div>
      `,
    }).catch(async (err: unknown) => {
      console.error('Resend error:', err)
      await adminClient.from('bookings').update({ notify_failed: true }).eq('id', inserted.id)
    })
  }

  return { success: true }
}
