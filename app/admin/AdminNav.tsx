'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { logout } from './actions'
import Icon, { type IconName } from './icons'

const tabs: { href: string; label: string; icon: IconName; match: (path: string) => boolean }[] = [
  { href: '/admin/leads', label: 'Leads', icon: 'inbox', match: path => path.startsWith('/admin/leads') },
  { href: '/admin/route', label: 'Today', icon: 'calendar', match: path => path.startsWith('/admin/route') || path.startsWith('/admin/week') },
  { href: '/admin', label: 'Jobs', icon: 'briefcase', match: path => path === '/admin' || path.startsWith('/admin/client') },
  { href: '/admin/customers', label: 'Customers', icon: 'users', match: path => path.startsWith('/admin/customers') },
  { href: '/admin/revenue', label: 'Revenue', icon: 'chart', match: path => path.startsWith('/admin/revenue') },
]

export default function AdminNav() {
  const path = usePathname()
  if (path === '/admin/login') return null

  return (
    <header className="admin-header">
      <Link href="/admin/leads" className="admin-header-logo">
        <Image src="/quietgreen-logo-full.svg" alt="QuietGreen" width={160} height={37} priority />
      </Link>
      <nav className="admin-nav" aria-label="Staff">
        {tabs.map(t => {
          const active = t.match(path)
          return (
            <Link key={t.href} href={t.href} className={`admin-nav-tab${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined}>
              <Icon name={t.icon} size={20} />
              <span>{t.label}</span>
            </Link>
          )
        })}
      </nav>
      <form action={logout} className="admin-logout-form">
        <button type="submit" className="admin-logout" aria-label="Sign out">
          <Icon name="logout" size={18} />
          <span>Sign out</span>
        </button>
      </form>
    </header>
  )
}
