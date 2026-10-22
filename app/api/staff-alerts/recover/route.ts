import { timingSafeEqual } from 'node:crypto'
import { recoverStaffAlerts } from '@/lib/staff-alerts'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const secret = process.env.ALERT_RECOVERY_SECRET
  const actual = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${secret}`
  if (!secret || secret.length < 32 || Buffer.byteLength(actual) !== Buffer.byteLength(expected)
    || !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    return Response.json(await recoverStaffAlerts())
  } catch {
    return Response.json({ error: 'Alert recovery failed' }, { status: 503 })
  }
}
