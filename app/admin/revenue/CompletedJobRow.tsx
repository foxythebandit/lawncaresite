import { jobPrice } from '@/lib/crm-jobs'

type Job = {
  id: string; name: string; address: string; completed_at: string
  job_total: number | string | null; price_per_visit: number | null
  amount_charged: number | null; payment_method: string | null
}
type Payment = { amount: number | string; paid_on: string; method: string }

export default function CompletedJobRow({ job, payments }: { job: Job; payments: Payment[] }) {
  const paid = payments.reduce((sum, payment) => sum + Number(payment.amount), 0)
  return <tr>
    <td>{new Date(job.completed_at.slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
    <td><a href={`/admin?search=${encodeURIComponent(job.name)}`}>{job.name}</a></td>
    <td>{job.address}</td>
    <td>{payments.length ? `${payments.length} payment${payments.length === 1 ? '' : 's'}` : job.amount_charged != null ? `Legacy: ${job.payment_method ?? 'method unknown'}` : 'Unpaid'}</td>
    <td>{payments.length ? `$${paid.toFixed(2)}` : job.amount_charged != null ? `$${job.amount_charged.toFixed(2)} legacy` : '—'}<br /><small>Job {`$${jobPrice(job).toFixed(2)}`}</small></td>
  </tr>
}
