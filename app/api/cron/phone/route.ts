import { cronAuthorized, sendDueReminders } from '@/lib/phone/cron'
import { recoverStaffAlerts } from '@/lib/staff-alerts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Vercel Cron, every 5 minutes (vercel.json): due "Log your call" reminders (S20) and the alert recovery sweep (R6, E17). */
export async function GET(request: Request) {
  if (!cronAuthorized(request.headers.get('authorization'))) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const [reminders, alerts] = await Promise.allSettled([sendDueReminders(), recoverStaffAlerts()])
  const ok = reminders.status === 'fulfilled' && alerts.status === 'fulfilled'
  return Response.json({
    reminders: reminders.status === 'fulfilled' ? reminders.value : 'failed',
    alerts: alerts.status === 'fulfilled' ? alerts.value : 'failed',
  }, { status: ok ? 200 : 503 })
}
