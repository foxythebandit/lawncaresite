import { NextResponse, type NextRequest } from 'next/server'
import { adminDb } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

/** Short lead link from staff texts (quietgreen.co/l/AB12CD). The lead page itself requires staff login. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const fallback = new URL('/admin/leads', request.url)
  if (!/^[23456789A-Z]{6}$/.test(code.toUpperCase())) return NextResponse.redirect(fallback)
  const { data } = await adminDb().from('leads').select('id').eq('short_code', code.toUpperCase()).maybeSingle()
  return NextResponse.redirect(data ? new URL(`/admin/leads/${data.id}`, request.url) : fallback)
}
