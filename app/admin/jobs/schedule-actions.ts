'use server'

import { revalidatePath } from 'next/cache'
import { requireStaff } from '@/lib/staff'
import { adminDb } from '@/lib/supabase/admin'
import type { Json } from '@/supabase/database.types'
import { commandError } from '@/lib/crm-jobs'
import { UUID, type ServiceLabel, type ServicePreview } from '@/lib/service-schedules'

type EditorTarget = { customerId: string } | { agreementId: string; version: string }
type Failure = { ok: false; error: string }

export async function reviewService(target: EditorTarget, request: Json, commit?: { operationId: string; preview: string }): Promise<
  Failure | { ok: true; review?: ServicePreview; bookingId?: string; agreementId?: string }
> {
  const staff = await requireStaff()
  const db = adminDb()
  const input = { p_request: request, p_staff_user_id: staff.id, p_operation_id: commit?.operationId, p_preview: commit?.preview }
  const id = 'agreementId' in target ? target.agreementId : target.customerId
  if (!UUID.test(id) || (commit && !UUID.test(commit.operationId))) return { ok: false, error: 'Open the service editor again.' }
  const result = 'agreementId' in target
    ? await db.rpc('crm_service_edit', { ...input, p_agreement_id: target.agreementId, p_expected_updated_at: target.version })
    : await db.rpc('crm_service_create', { ...input, p_customer_id: target.customerId })
  if (result.error) return { ok: false, error: result.error.code === 'PT409' && result.error.message.includes('preview')
    ? result.error.message : commandError(result.error) }
  if (!commit) return { ok: true, review: result.data as unknown as ServicePreview }
  for (const path of ['/admin/jobs', '/admin/route', '/admin/week', '/admin/customers', '/admin/revenue']) revalidatePath(path)
  const data = result.data as { booking_id?: string; agreement_id?: string }
  return { ok: true, bookingId: data.booking_id, agreementId: data.agreement_id }
}

export async function saveServiceLabel(input: { id?: string; version?: string; name: string; retire: boolean; operationId: string }): Promise<
  Failure | { ok: true; label: ServiceLabel }
> {
  const staff = await requireStaff()
  if (!UUID.test(input.operationId) || (input.id && !UUID.test(input.id))) return { ok: false, error: 'Open the label editor again.' }
  const { data, error } = await adminDb().rpc('crm_save_service_label', {
    p_id: input.id ?? null, p_expected_updated_at: input.version ?? null,
    p_name: input.name, p_retire: input.retire, p_operation_id: input.operationId, p_staff_user_id: staff.id,
  })
  if (error) return { ok: false, error: error.code === '23505' && error.message.includes('service_labels_active_name_idx')
    ? 'An active label already uses that name.' : commandError(error) }
  revalidatePath('/admin/customers')
  return { ok: true, label: data as unknown as ServiceLabel }
}
