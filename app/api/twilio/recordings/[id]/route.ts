import { isStaff } from '@/lib/staff-policy'
import { basicAuth, twilioConfig, UUID } from '@/lib/phone/twilio'
import { adminDb } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const plain = (status: number) => new Response(null, { status, headers: { 'Cache-Control': 'private, no-store' } })

/**
 * Staff-only playback of a customer call recording (P3, R13). `id` is lead_calls.id. The audio
 * stays in Twilio behind HTTP auth; this streams it through, passing Range for seeking.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!isStaff(user)) return plain(401)
  const { id } = await params
  if (!UUID.test(id)) return plain(404)
  const { data: call } = await adminDb().from('lead_calls').select('recording_sid').eq('id', id).maybeSingle()
  const config = twilioConfig()
  if (!call?.recording_sid || !/^RE[0-9a-f]{32}$/.test(call.recording_sid)) return plain(404)
  if (!config) return plain(503)
  const range = request.headers.get('range')
  let upstream: Response
  try {
    upstream = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.sid}/Recordings/${call.recording_sid}.mp3`, {
      headers: { Authorization: basicAuth(config.sid, config.token), ...(range && /^bytes=\d*-\d*$/.test(range) ? { Range: range } : {}) },
      cache: 'no-store', signal: AbortSignal.timeout(30000),
    })
  } catch { return plain(502) }
  if (!upstream.ok || !upstream.body) return plain(upstream.status === 404 ? 404 : 502)
  const headers = new Headers({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, no-store', 'Accept-Ranges': 'bytes' })
  for (const name of ['content-length', 'content-range']) {
    const value = upstream.headers.get(name)
    if (value) headers.set(name, value)
  }
  return new Response(upstream.body, { status: upstream.status, headers })
}
