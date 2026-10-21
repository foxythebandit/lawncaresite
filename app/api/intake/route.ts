import { timingSafeEqual } from 'node:crypto'
import { canonicalIntake } from '@/lib/canonical-intake'
import { recordIntake } from '@/lib/intake'
export const runtime = 'nodejs'
export async function POST(request: Request) {
  const secret = process.env.INTAKE_WEBHOOK_SECRET
  const actual = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${secret}`
  if (!secret || secret.length < 32 || Buffer.byteLength(actual) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!request.headers.get('content-type')?.startsWith('application/json')) return Response.json({ error: 'Expected JSON' }, { status: 415 })
  // Bound streaming bodies too; Content-Length is not trusted.
  const reader = request.body?.getReader()
  if (!reader) return Response.json({ error: 'Missing body' }, { status: 400 })
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > 32768) { await reader.cancel(); return Response.json({ error: 'Payload too large' }, { status: 413 }) }
    chunks.push(value)
  }
  let parsed
  try { parsed = canonicalIntake(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
  catch { return Response.json({ error: 'Invalid canonical intake payload' }, { status: 400 }) }
  try {
    const result = await recordIntake('conviflo', parsed.submission, parsed.lead)
    return Response.json({ lead_id: result.lead_id, event_id: result.event_id, duplicate: result.duplicate }, { status: result.duplicate ? 200 : 201 })
  } catch (error) {
    return Response.json({ error: 'Intake not accepted; retain submission ID when retrying' }, { status: error instanceof Error && error.message === 'Submission ID conflict' ? 409 : 503 })
  }
}
