import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'
import { isStaff, keepsStaffQuery, staffReturnTo } from '@/lib/staff-policy'

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })
  const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values) {
        values.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })
  const { data: { user } } = await client.auth.getUser()
  const { pathname, search } = request.nextUrl
  if (pathname.startsWith('/admin') && pathname !== '/admin/login' && !isStaff(user)) {
    const url = new URL('/admin/login', request.url)
    url.searchParams.set('next', staffReturnTo(keepsStaffQuery(pathname) ? pathname + search : pathname))
    const redirect = NextResponse.redirect(url)
    response.cookies.getAll().forEach(cookie => redirect.cookies.set(cookie))
    return redirect
  }
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}
export const config = { matcher: ['/admin/:path*', '/portal/:path*'] }
