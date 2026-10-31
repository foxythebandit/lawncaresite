import type { Metadata, Viewport } from 'next'
import { Suspense } from 'react'
import AdminNav from './AdminNav'
import NavProgress from './NavProgress'
import './crm.css'

export const metadata: Metadata = { robots: { index: false, follow: false } }
export const viewport: Viewport = { themeColor: '#fbfbf9' }

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin-wrap">
      <Suspense><NavProgress /></Suspense>
      <AdminNav />
      <div className="admin-main">{children}</div>
    </div>
  )
}
