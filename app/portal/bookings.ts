import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/supabase/database.types'

const fields = 'id, email, created_at, status, confirmed_date, preferred_date, confirmed_time, address, sq_ft, frequency, price_per_visit, job_total, map_screenshot_url, completed_at, amount_charged, payment_method, payment_link'

export async function getPortalBookings(supabase: SupabaseClient<Database>, today: string) {
  // The signed-in customer's RLS applies to all three reads.
  const [{ data: upcoming }, { data: overdue }, { data: bookings }] = await Promise.all([
    supabase.from('bookings').select(fields).eq('status', 'confirmed')
      .or(`confirmed_date.gte.${today},and(confirmed_date.is.null,preferred_date.gte.${today})`)
      .order('confirmed_date', { nullsFirst: false }).order('preferred_date').order('id').limit(1).maybeSingle(),
    supabase.from('bookings').select(fields).eq('status', 'confirmed')
      .or(`confirmed_date.lt.${today},and(confirmed_date.is.null,preferred_date.lt.${today})`)
      .order('confirmed_date', { ascending: false, nullsFirst: false })
      .order('preferred_date', { ascending: false }).order('id').limit(1).maybeSingle(),
    supabase.from('bookings').select(fields).in('status', ['completed', 'pending'])
      .order('created_at', { ascending: false }),
  ])
  return { upcoming, overdue, bookings: bookings ?? [] }
}
