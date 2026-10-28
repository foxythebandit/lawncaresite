import 'server-only'

/**
 * Staff text to the other person after a Log call is saved (PLAN.md 7.3, S19).
 * Contract for the CRM: call after crm_log_call succeeds; never throws; respects STAFF_SMS_ENABLED.
 * Implemented by the phone flow.
 */
export async function notifyCallLogged(leadId: string, activityId: string, actorEmail: string): Promise<void> {
  void leadId; void activityId; void actorEmail
}
