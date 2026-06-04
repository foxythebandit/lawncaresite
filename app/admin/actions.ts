'use server'

import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  )
}

export async function login(_: unknown, formData: FormData) {
  const password = formData.get('password') as string
  if (password !== process.env.ADMIN_PASSWORD) {
    return { error: 'Wrong password.' }
  }
  const jar = await cookies()
  jar.set('qg_admin', process.env.ADMIN_TOKEN!, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  })
  redirect('/admin')
}

export async function logout() {
  const jar = await cookies()
  jar.delete('qg_admin')
  redirect('/admin/login')
}

export async function updateStatus(id: string, status: string) {
  await getAdmin().from('bookings').update({ status }).eq('id', id)
  revalidatePath('/admin')
}

export async function getBookings() {
  const { data } = await getAdmin()
    .from('bookings')
    .select('*')
    .order('created_at', { ascending: false })
  return data ?? []
}
