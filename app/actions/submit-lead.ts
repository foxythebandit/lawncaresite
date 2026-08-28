'use server'

import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )
}

function h(s: string | null | undefined) {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const PHONE_RE = /^[\d\s()+-]{7,}$/

export interface LeadData {
  phone:   string
  address: string
  sq_ft:   number | null
}

export async function submitLead(data: LeadData): Promise<{ success: boolean; error?: string }> {
  const phone = data.phone.trim()
  if (!PHONE_RE.test(phone)) {
    return { success: false, error: 'Please enter a valid phone number.' }
  }

  const supabase = getSupabase()
  const { error } = await supabase.from('leads').insert({
    phone,
    address: data.address || null,
    sq_ft: data.sq_ft,
  })

  if (error) {
    return { success: false, error: 'Something went wrong. Please try again.' }
  }

  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY)
    await resend.emails.send({
      // TODO: switch to hello@quietgreen.co once the domain is verified at resend.com/domains
      from: 'QuietGreen Leads <onboarding@resend.dev>',
      to: 'paxonearth.22@gmail.com',
      subject: `New quote lead — ${phone}`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#111c17">
          <div style="background:#1a3a2a;padding:20px 24px;border-radius:12px 12px 0 0">
            <p style="color:#52b788;font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin:0">New Quote Lead</p>
          </div>
          <div style="background:#f7f6f2;padding:20px 24px;border-radius:0 0 12px 12px;border:1px solid #e0ede6;border-top:none">
            <table style="width:100%;border-collapse:collapse;margin-bottom:12px">
              <tr><td style="padding:6px 0;color:#4a5e54;font-size:13px;width:100px">Phone</td><td style="padding:6px 0;font-size:14px;font-weight:500"><a href="tel:${h(phone)}" style="color:#1a3a2a">${h(phone)}</a></td></tr>
              ${data.address ? `<tr><td style="padding:6px 0;color:#4a5e54;font-size:13px">Address</td><td style="padding:6px 0;font-size:14px;font-weight:500">${h(data.address)}</td></tr>` : ''}
              ${data.sq_ft ? `<tr><td style="padding:6px 0;color:#4a5e54;font-size:13px">Lawn size</td><td style="padding:6px 0;font-size:14px;font-weight:500">${data.sq_ft.toLocaleString()} sq ft</td></tr>` : ''}
            </table>
            <p style="margin:0;color:#8a978f;font-size:12px">They unlocked a price but haven't booked yet — this is a soft lead, not a confirmed booking.</p>
          </div>
        </div>
      `,
    }).catch((err: unknown) => { console.error('Resend error:', err) })
  }

  return { success: true }
}
