import { formatMoney, formatMoneyWhole } from '@/lib/crm-jobs'

interface Props {
  id: string
  href: string
  name: string
  annual: number
  perVisit: number
  widthPct: number
}

export default function RecurringClientRow({ href, name, annual, perVisit, widthPct }: Props) {
  return <div className="admin-expected-bar-row">
    <a href={href} className="admin-expected-bar-name" style={{ textDecoration: 'none', color: 'inherit' }}>{name}</a>
    <div className="admin-expected-bar-track"><div className="admin-expected-bar-fill" style={{ width: `${widthPct}%` }} /></div>
    <span className="admin-expected-bar-val" title={`${formatMoney(perVisit)} × 30 conservative mowing visits`}>
      {formatMoneyWhole(annual)}/yr<small>{formatMoney(perVisit)} × 30</small>
    </span>
  </div>
}
