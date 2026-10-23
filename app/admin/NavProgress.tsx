'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

// Top loading bar + "you tapped this" state for every in-app link in the CRM.
// The clicked link gets data-nav-pending until the new URL commits, so tabs,
// lead rows and customer cards can all show the press without their own state.
function clearPending() {
  document.querySelectorAll('[data-nav-pending]').forEach(el => el.removeAttribute('data-nav-pending'))
}

export default function NavProgress() {
  const path = usePathname()
  const search = useSearchParams().toString()
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle')

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const link = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!link || (link.target && link.target !== '_self') || link.hasAttribute('download')) return
      const url = new URL(link.href, location.href)
      if (url.origin !== location.origin || !url.pathname.startsWith('/admin')) return
      if (url.pathname === location.pathname && url.search === location.search) return
      clearPending()
      link.setAttribute('data-nav-pending', '')
      setState('loading')
      // Never leave the bar stuck if a navigation is abandoned.
      clearTimeout(timer)
      timer = setTimeout(() => { clearPending(); setState('idle') }, 10000)
    }
    // Capture phase: next/link calls preventDefault on its own click before a bubbling listener would see it.
    document.addEventListener('click', onClick, true)
    return () => { document.removeEventListener('click', onClick, true); clearTimeout(timer) }
  }, [])

  useEffect(() => {
    clearPending()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the URL commit is an external event
    setState(s => s === 'loading' ? 'done' : s)
  }, [path, search])

  useEffect(() => {
    if (state !== 'done') return
    const t = setTimeout(() => setState('idle'), 400)
    return () => clearTimeout(t)
  }, [state])

  return <div className={`crm-nav-progress crm-nav-progress-${state}`} aria-hidden="true"><span /></div>
}
