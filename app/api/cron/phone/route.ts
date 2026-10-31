import { cronAuthorized, sendDueReminders } from '@/lib/phone/cron'
import { retryFailedStaffTexts } from '@/lib/phone/staff-texts'
import { recoverStaffAlerts } from '@/lib/staff-alerts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Supabase pg_cron job `crm-phone`, every 5 minutes (migration 20261029130000): due "Log your call" reminders (S20), retries of rejected staff texts and the alert recovery sweep (R6, E17). */
export async function GET(request: Request) {
  if (!cronAuthorized(request.headers.get('authorization'))) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const [reminders, alerts, texts] = await Promise.allSettled([sendDueReminders(), recoverStaffAlerts(), retryFailedStaffTexts()])
  const ok = reminders.status === 'fulfilled' && alerts.status === 'fulfilled' && texts.status === 'fulfilled'
  return Response.json({
    reminders: reminders.status === 'fulfilled' ? reminders.value : 'failed',
    alerts: alerts.status === 'fulfilled' ? alerts.value : 'failed',
    texts: texts.status === 'fulfilled' ? texts.value : 'failed',
  }, { status: ok ? 200 : 503 })
}
