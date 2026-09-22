'use server'

import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { formatAttributionLabel, type Attribution } from '@/lib/attribution'

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

export interface LeadData extends Attribution {
  phone:          string
  address:        string
  sq_ft:          number | null
  consent:        boolean
  consentText:    string
  map_screenshot?: string
}

export async function submitLead(data: LeadData): Promise<{ success: boolean; error?: string }> {
  const phone = data.phone.trim()
  if (!PHONE_RE.test(phone)) {
    return { success: false, error: 'Please enter a valid phone number.' }
  }
  if (!data.consent) {
    return { success: false, error: 'Please check the box to consent to being contacted.' }
  }

  // Upload the traced-lawn map screenshot to Supabase Storage (service-role
  // client, since the public/anon client can't write to storage)
  let screenshotUrl: string | null = null
  if (data.map_screenshot) {
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!
    )
    const base64 = data.map_screenshot.split(',')[1]
    if (base64) {
      const buffer = Buffer.from(base64, 'base64')
      const filename = `lead-${Date.now()}-${crypto.randomUUID().replace(/-/g, '')}.jpg`
      const { data: uploaded } = await adminClient.storage
        .from('booking-maps')
        .upload(filename, buffer, { contentType: 'image/jpeg' })
      if (uploaded) {
        const { data: urlData } = adminClient.storage.from('booking-maps').getPublicUrl(filename)
        screenshotUrl = urlData.publicUrl
      }
    }
  }

  const supabase = getSupabase()
  const { error } = await supabase.from('leads').insert({
    phone,
    address: data.address || null,
    sq_ft: data.sq_ft,
    map_screenshot_url: screenshotUrl,
    gclid: data.gclid || null,
    utm_source: data.utm_source || null,
    utm_medium: data.utm_medium || null,
    utm_campaign: data.utm_campaign || null,
    utm_term: data.utm_term || null,
    utm_content: data.utm_content || null,
    consent: true,
    consent_text: data.consentText,
    consented_at: new Date().toISOString(),
  })

  if (error) {
    return { success: false, error: 'Something went wrong. Please try again.' }
  }

  if (process.env.RESEND_API_KEY) {
    const source = formatAttributionLabel(data)
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
              ${source ? `<tr><td style="padding:6px 0;color:#4a5e54;font-size:13px">Source</td><td style="padding:6px 0;font-size:14px;font-weight:500">${h(source)}</td></tr>` : ''}
            </table>
            ${screenshotUrl ? `
            <div style="margin-bottom:12px">
              <p style="margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#4a5e54">Traced lawn</p>
              <img src="${screenshotUrl}" alt="Traced lawn" style="width:100%;border-radius:10px;border:1px solid #e0ede6;display:block"/>
            </div>` : ''}
            <p style="margin:0;color:#8a978f;font-size:12px">They unlocked a price but haven't booked yet — this is a soft lead, not a confirmed booking.</p>
          </div>
        </div>
      `,
    }).catch((err: unknown) => { console.error('Resend error:', err) })
  }

  return { success: true }
}
