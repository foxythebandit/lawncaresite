'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useRef } from 'react'

export default function AdminSearch({ defaultValue, filter }: { defaultValue: string; filter: string }) {
  const router = useRouter()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const onChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      const params = new URLSearchParams()
      params.set('filter', filter)
      if (val.trim()) params.set('search', val.trim())
      router.push(`/admin?${params.toString()}`)
    }, 300)
  }, [filter, router])

  return (
    <input
      className="admin-search-input"
      type="search"
      placeholder="Search name, address, phone…"
      defaultValue={defaultValue}
      onChange={onChange}
    />
  )
}
