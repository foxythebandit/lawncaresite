import type { Metadata } from 'next'
import AdminNav from './AdminNav'
import './crm.css'

export const metadata: Metadata = { robots: { index: false, follow: false } }

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin-wrap">
      <AdminNav />
      {children}
    </div>
  )
}
