import 'server-only'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isStaff, staffReturnTo } from './staff-policy'

export async function requireStaff(returnTo = '/admin') {
  const client = await createClient()
  const { data: { user }, error } = await client.auth.getUser()
  if (error || !isStaff(user)) redirect(`/admin/login?next=${encodeURIComponent(staffReturnTo(returnTo))}`)
  return user!
}
