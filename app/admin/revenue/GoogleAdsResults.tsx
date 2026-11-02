'use client'

import { useSyncExternalStore } from 'react'
import { formatMoney, formatMoneyWhole } from '@/lib/crm-jobs'
import type { GoogleCustomer } from '@/lib/google-ads-revenue'

const SPEND_KEY = 'qg_google_ads_spend'
const listeners = new Set<() => void>()
// Used when storage is blocked, so typing still works for this page view.
let fallback = ''

function subscribe(listener: () => void) {
  listeners.add(listener)
  window.addEventListener('storage', listener)
  return () => { listeners.delete(listener); window.removeEventListener('storage', listener) }
}

function readSpend() {
  try { return localStorage.getItem(SPEND_KEY) ?? fallback } catch { return fallback }
}

type Props = {
  customers: GoogleCustomer[]
  paidPlan: number
  paidOneTime: number
  annualForecast: number
  planCount: number
}

/** Money from customers whose first known click was a Google ad, against spend typed in from Google Ads. */
export default function GoogleAdsResults({ customers, paidPlan, paidOneTime, annualForecast, planCount }: Props) {
  // Spend lives in Google Ads; staff copy it here. Kept in this browser only, never saved to the CRM.
  const spend = useSyncExternalStore(subscribe, readSpend, () => '')
  const updateSpend = (value: string) => {
    try { localStorage.setItem(SPEND_KEY, value) } catch { /* Storage may be unavailable. */ }
    fallback = value
    listeners.forEach(listener => listener())
  }
  const paid = paidPlan + paidOneTime
  const spent = Number(spend)
  const hasSpend = Number.isFinite(spent) && spent > 0

  return (
    <section className="admin-revenue-card" aria-label="Google Ads results">
      <div className="admin-revenue-card-title">Google Ads results</div>
      <p className="admin-revenue-sub">Customers whose first tracked visit came from a Google ad click. Every later visit they pay for counts here. Customers with no recorded click aren’t guessed.</p>

      <div className="admin-stats">
        <div className="admin-stat">
          <span className="admin-stat-val">{customers.length}</span>
          <span className="admin-stat-label">Customers from Google</span>
          <span className="admin-stat-hint">{planCount} on a mowing plan</span>
        </div>
        <div className="admin-stat">
          <span className="admin-stat-val admin-stat-money">{formatMoneyWhole(paid)}</span>
          <span className="admin-stat-label">Paid so far</span>
          <span className="admin-stat-hint">{formatMoneyWhole(paidPlan)} plan visits · {formatMoneyWhole(paidOneTime)} one-time</span>
        </div>
        <div className="admin-stat">
          <span className="admin-stat-val admin-stat-money">{formatMoneyWhole(annualForecast)}</span>
          <span className="admin-stat-label">Mowing forecast / year</span>
          <span className="admin-stat-hint">Same ~30 mows estimate as below; not collected money</span>
        </div>
      </div>

      <div className="admin-extra-form">
        <label className="admin-extra-field">
          <span>Google Ads spend to date (from Google Ads → Billing)</span>
          <input type="number" min="0" step="0.01" inputMode="decimal" value={spend}
            onChange={e => updateSpend(e.target.value)} className="admin-revenue-edit-input" placeholder="0.00" />
        </label>
        {hasSpend && (
          <p className="crm-muted" style={{ alignSelf: 'end', margin: 0 }}>
            {formatMoney(paid)} paid for {formatMoney(spent)} spent: <strong>{(paid / spent).toFixed(2)}×</strong> back so far
            {customers.length > 0 && <> · {formatMoney(spent / customers.length)} per customer</>}
            {annualForecast > 0 && <> · {((paid + annualForecast) / spent).toFixed(1)}× counting a year of plan visits</>}
          </p>
        )}
      </div>

      {customers.length === 0 ? (
        <div className="admin-empty">No customers with a recorded Google ad click yet.</div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-revenue-table">
            <thead><tr><th>Customer</th><th>Type</th><th>First ad click</th><th>Paid visits</th><th>Paid</th></tr></thead>
            <tbody>
              {customers.map(c => (
                <tr key={c.key}>
                  <td>{c.name}</td>
                  <td>{c.plan ? 'Mowing plan' : 'One-time'}</td>
                  <td>{c.firstClick}</td>
                  <td>{c.visits}</td>
                  <td>{formatMoney(c.paid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
