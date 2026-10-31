import { redirect } from 'next/navigation'

/** /admin opens the lead board (PLAN.md 6.1). Old Jobs links (`/admin?search=…`) still land on Jobs. */
export default async function AdminHome({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  const kept = new URLSearchParams()
  for (const key of ['filter', 'search', 'view']) {
    const value = params[key]
    if (typeof value === 'string') kept.set(key, value)
  }
  redirect(kept.size ? `/admin/jobs?${kept}` : '/admin/leads')
}
