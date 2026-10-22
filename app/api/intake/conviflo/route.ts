import { createHmac, timingSafeEqual } from 'node:crypto'
import { convifloIntake } from '@/lib/conviflo-intake'
import { recordIntake } from '@/lib/intake'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const secret = process.env.CONVIFLO_WEBHOOK_SECRET
  const signature = request.headers.get('x-conviflow-signature') ?? ''
  if (!secret || secret.length < 32) return Response.json({ error: 'Webhook unavailable' }, { status: 503 })
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    return Response.json({ error: 'Expected JSON' }, { status: 415 })
  }
  const reader = request.body?.getReader()
  if (!reader) return Response.json({ error: 'Missing body' }, { status: 400 })
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > 32768) { await reader.cancel(); return Response.json({ error: 'Payload too large' }, { status: 413 }) }
    chunks.push(value)
  }
  const raw = Buffer.concat(chunks)
  const expected = createHmac('sha256', secret).update(raw).digest('hex')
  if (!/^[0-9a-f]{64}$/i.test(signature) || !timingSafeEqual(Buffer.from(signature.toLowerCase()), Buffer.from(expected))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  let mapped
  try {
    const forms = JSON.parse(process.env.CONVIFLO_FORMS ?? '{}')
    mapped = convifloIntake(JSON.parse(raw.toString('utf8')), forms)
  } catch {
    return Response.json({ error: 'Completed lead requires a configured form, address and valid fields' }, { status: 422 })
  }
  if (!mapped) return Response.json({ ignored: true })
  try {
    const result = await recordIntake('conviflo', mapped.submission, mapped.lead)
    return Response.json({ lead_id: result.lead_id, event_id: result.event_id, duplicate: result.duplicate },
      { status: result.duplicate ? 200 : 201 })
  } catch (error) {
    return Response.json({ error: 'Lead not accepted; retain responseId when retrying' },
      { status: error instanceof Error && error.message === 'Submission ID conflict' ? 409 : 503 })
  }
}
