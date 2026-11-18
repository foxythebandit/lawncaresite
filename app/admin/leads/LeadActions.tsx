'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { moveLead } from './board-actions'

/** Closed → In talks, the lead page's main button for a closed lead (UX audit Q2). */
export function ReopenButton({ leadId, className }: { leadId: string; className: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')
  return <>
    <button type="button" className={className} disabled={pending} onClick={() => startTransition(async () => {
      const result = await moveLead(leadId, 'in_talks').catch(() => ({ ok: false as const, error: 'Not saved' }))
      if (result.ok) router.refresh(); else setError(result.error)
    })}>Reopen</button>
    {error && <span className="crm-error" role="alert">{error}</span>}
  </>
}
