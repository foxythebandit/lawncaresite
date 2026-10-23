import type { Metadata, Viewport } from 'next'
import AdminNav from './AdminNav'
import './crm.css'

export const metadata: Metadata = { robots: { index: false, follow: false } }
export const viewport: Viewport = { themeColor: '#fbfbf9' }

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin-wrap">
      <AdminNav />
      <div className="admin-main">{children}</div>
    </div>
  )
}
