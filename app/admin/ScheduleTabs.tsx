import Link from 'next/link'

export default function ScheduleTabs({ current }: { current: 'today' | 'week' }) {
  return <div className="crm-filter-row" role="navigation" aria-label="Schedule range">
    <Link className="crm-filter" href="/admin/route" aria-current={current === 'today' ? 'page' : undefined}>Today</Link>
    <Link className="crm-filter" href="/admin/week" aria-current={current === 'week' ? 'page' : undefined}>Next 7 days</Link>
  </div>
}
