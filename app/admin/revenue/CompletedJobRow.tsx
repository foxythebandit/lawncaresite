import { formatMoney, jobPrice } from '@/lib/crm-jobs'

type Job = {
  id: string; name: string; address: string; completed_at: string
  job_total: number | string | null; price_per_visit: number | null
  amount_charged: number | null; payment_method: string | null
}
type Payment = { amount: number | string; paid_on: string; method: string }

export default function CompletedJobRow({ job, payments }: { job: Job; payments: Payment[] }) {
  const paid = payments.reduce((sum, payment) => sum + Number(payment.amount), 0)
  const price = jobPrice(job)
  const status = payments.length ? (paid >= price ? 'Paid in full' : 'Partly paid') : job.amount_charged != null ? 'Older record' : 'Unpaid'
  return <tr>
    <td>{new Date(job.completed_at.slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
    <td><a href={`/admin?search=${encodeURIComponent(job.name)}`}>{job.name}</a><br /><small>{status}</small></td>
    <td>{job.address}</td>
    <td>{formatMoney(price)}</td>
    <td>{payments.length ? formatMoney(paid) : '—'}{job.amount_charged != null && <><br /><small>{formatMoney(job.amount_charged)} older record{job.payment_method ? ` · ${job.payment_method}` : ''}</small></>}</td>
  </tr>
}
