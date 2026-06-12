'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { logout } from './actions'

export default function AdminNav() {
  const path = usePathname()
  if (path === '/admin/login') return null

  const tabs = [
    { href: '/admin',         label: 'Clients' },
    { href: '/admin/revenue', label: 'Revenue' },
    { href: '/admin/route',   label: 'Today'   },
  ]

  return (
    <header className="admin-header">
      <div className="admin-header-logo">
        <span className="logo-dot" style={{ background: 'var(--green-bright)', width: 9, height: 9, borderRadius: '50%', display: 'inline-block' }} />
        <span>QuietGreen</span>
      </div>
      <nav className="admin-nav">
        {tabs.map(t => {
          const active = t.href === '/admin' ? path === '/admin' : path.startsWith(t.href)
          return (
            <Link key={t.href} href={t.href} className={`admin-nav-tab${active ? ' active' : ''}`}>
              {t.label}
            </Link>
          )
        })}
      </nav>
      <form action={logout}>
        <button type="submit" className="admin-logout">Sign out</button>
      </form>
    </header>
  )
}
