import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { adminDb } from '@/lib/supabase/admin'
import { isStaff } from '@/lib/staff-policy'

export const dynamic = 'force-dynamic'

/** Short lead link from staff texts (quietgreen.co/l/AB12CD). Resolved only for signed-in staff. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const code = (await params).code.toUpperCase()
  if (!/^[23456789A-Z]{6}$/.test(code)) return NextResponse.redirect(new URL('/admin/leads', request.url))
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!isStaff(user)) return NextResponse.redirect(new URL(`/admin/login?next=${encodeURIComponent(`/l/${code}`)}`, request.url))
  const { data } = await adminDb().from('leads').select('id').eq('short_code', code).maybeSingle()
  return NextResponse.redirect(new URL(data ? `/admin/leads/${data.id}` : '/admin/leads', request.url))
}
