'use client'

import { useState } from 'react'
import Link from 'next/link'

type Mode = 'starter' | 'full'

const DEFAULTS = {
  jobPrice:      66,
  employeeRate:  22,
  minMow:        20,
  minFinish:     10,
  minTravel:     15,
  jobsPerWeek:   10,
  seasonWeeks:   40,
  // equipment
  zeroTurn:      4000,
  blower:        250,
  weedEater:     500,
  trailer:       3000,
  vehicle:       50000,
  // insurance
  insuranceStarter: 1200,
  insuranceFull:    2500,
  // depreciation years
  equipYears:    5,
  vehicleYears:  8,
}

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function fmtDec(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function CalculatorPage() {
  const [mode, setMode] = useState<Mode>('starter')
  const [v, setV] = useState(DEFAULTS)

  const set = (key: keyof typeof DEFAULTS) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setV(prev => ({ ...prev, [key]: parseFloat(e.target.value) || 0 }))

  // Time
  const totalMin    = v.minMow + v.minFinish + v.minTravel * 2
  const totalHrs    = totalMin / 60

  // Per-job costs
  const stripeFee    = v.jobPrice * 0.029 + 0.30
  const employeeCost = v.employeeRate * totalHrs
  const grossPerJob  = v.jobPrice - stripeFee - employeeCost

  // Annual fixed costs
  const equipDepreciation = (v.zeroTurn + v.blower + v.weedEater + v.trailer) / v.equipYears
  const vehicleDepreciation = mode === 'full' ? v.vehicle / v.vehicleYears : 0
  const insurance = mode === 'starter' ? v.insuranceStarter : v.insuranceFull
  const annualFixed = equipDepreciation + vehicleDepreciation + insurance

  // Per-job fixed cost
  const jobsPerYear  = v.jobsPerWeek * v.seasonWeeks
  const fixedPerJob  = jobsPerYear > 0 ? annualFixed / jobsPerYear : 0

  // Net
  const netPerJob  = grossPerJob - fixedPerJob
  const netPerYear = netPerJob * jobsPerYear
  const effectiveHourlyRate = totalHrs > 0 ? netPerJob / totalHrs : 0

  const isProfit = netPerJob >= 0

  // Payback period
  const upfront = v.zeroTurn + v.blower + v.weedEater + v.trailer + (mode === 'full' ? v.vehicle : 0)
  const insurancePerJob = jobsPerYear > 0 ? insurance / jobsPerYear : 0
  const contributionPerJob = grossPerJob - insurancePerJob
  const paybackJobs  = contributionPerJob > 0 ? Math.ceil(upfront / contributionPerJob) : Infinity
  const paybackWeeks = v.jobsPerWeek > 0 ? paybackJobs / v.jobsPerWeek : Infinity
  const paybackMonths = paybackWeeks / 4.33

  return (
    <div className="admin-wrap">
      <header className="admin-header">
        <div className="admin-header-logo">
          <span className="logo-dot" style={{ background: 'var(--green-bright)', width: 9, height: 9, borderRadius: '50%', display: 'inline-block' }} />
          <span>QuietGreen</span>
        </div>
        <Link href="/admin" style={{ fontSize: 13, color: 'rgba(255,255,255,.7)', textDecoration: 'none' }}>
          ← Bookings
        </Link>
      </header>

      <div style={{ maxWidth: 560, margin: '0 auto', padding: '24px 16px 60px' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 24, color: 'var(--green-deep)', marginBottom: 4 }}>
          Job Calculator
        </h2>
        <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 24 }}>
          Private — not visible to customers.
        </p>

        {/* Mode toggle */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          {(['starter', 'full'] as Mode[]).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                flex: 1, padding: '10px 0', borderRadius: 100,
                border: '1px solid var(--rule)',
                background: mode === m ? 'var(--green-deep)' : '#fff',
                color: mode === m ? '#fff' : 'var(--ink-soft)',
                fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500,
                cursor: 'pointer', transition: 'all .15s',
              }}
            >
              {m === 'starter' ? 'Starter (own vehicle)' : 'Full buildout (Rivian)'}
            </button>
          ))}
        </div>

        {/* Inputs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 28 }}>
          <Section label="Per Job">
            <Row label="Job price ($)" value={v.jobPrice} onChange={set('jobPrice')} />
            <Row label="Employee rate ($/hr)" value={v.employeeRate} onChange={set('employeeRate')} />
            <Row label="Mow time (min)" value={v.minMow} onChange={set('minMow')} />
            <Row label="Blow + weed eat (min)" value={v.minFinish} onChange={set('minFinish')} />
            <Row label="Travel one way (min)" value={v.minTravel} onChange={set('minTravel')} />
          </Section>

          <Section label="Volume">
            <Row label="Jobs per week" value={v.jobsPerWeek} onChange={set('jobsPerWeek')} />
            <Row label="Season length (weeks)" value={v.seasonWeeks} onChange={set('seasonWeeks')} />
          </Section>

          <Section label="Equipment">
            <Row label="Zero turn ($)" value={v.zeroTurn} onChange={set('zeroTurn')} />
            <Row label="Blower ($)" value={v.blower} onChange={set('blower')} />
            <Row label="Weed eater ($)" value={v.weedEater} onChange={set('weedEater')} />
            <Row label="Enclosed trailer ($)" value={v.trailer} onChange={set('trailer')} />
            {mode === 'full' && (
              <Row label="Rivian ($)" value={v.vehicle} onChange={set('vehicle')} />
            )}
            <Row label="Equipment depreciation (yrs)" value={v.equipYears} onChange={set('equipYears')} />
            {mode === 'full' && (
              <Row label="Vehicle depreciation (yrs)" value={v.vehicleYears} onChange={set('vehicleYears')} />
            )}
            <Row label={`Insurance ($/yr)`} value={mode === 'starter' ? v.insuranceStarter : v.insuranceFull} onChange={set(mode === 'starter' ? 'insuranceStarter' : 'insuranceFull')} />
          </Section>
        </div>

        {/* Results */}
        <div style={{ background: 'var(--green-deep)', borderRadius: 16, padding: '24px 20px', color: '#fff' }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'rgba(255,255,255,.45)', marginBottom: 16 }}>
            Results
          </div>

          <ResultRow label={`Total time per job`} value={`${totalMin} min (${totalHrs.toFixed(2)} hrs)`} />
          <ResultRow label="Stripe fee / job" value={fmtDec(stripeFee)} sub="2.9% + $0.30" />
          <ResultRow label="Employee cost / job" value={fmtDec(employeeCost)} />
          <ResultRow label="Gross profit / job" value={fmtDec(grossPerJob)} />
          <ResultRow label="Fixed cost / job" value={fmtDec(fixedPerJob)} sub={`${fmt(annualFixed)}/yr ÷ ${jobsPerYear} jobs`} />

          <div style={{ height: 1, background: 'rgba(255,255,255,.1)', margin: '16px 0' }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.45)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>
                You take home
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 40, color: isProfit ? 'var(--green-bright)' : '#ff9999', lineHeight: 1 }}>
                {fmtDec(netPerJob)}
              </div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,.5)', marginTop: 4 }}>
                per job · {fmtDec(effectiveHourlyRate)}/hr effective
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.45)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>
                Per season
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, color: isProfit ? '#fff' : '#ff9999' }}>
                {fmt(netPerYear)}
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', marginTop: 2 }}>
                {jobsPerYear} jobs × {fmtDec(netPerJob)}
              </div>
            </div>
          </div>
        {/* Payback period */}
        <div style={{ marginTop: 12, background: '#fff', border: '1px solid var(--rule)', borderRadius: 16, padding: '20px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: 14 }}>
            Payback Period
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 16 }}>
            Upfront cost: <strong style={{ color: 'var(--ink)' }}>{fmt(upfront)}</strong>
            &nbsp;·&nbsp;
            {fmt(contributionPerJob)} toward payback per job
          </div>
          {paybackJobs === Infinity ? (
            <p style={{ fontSize: 14, color: '#c0392b' }}>Not profitable at current settings — adjust price or volume.</p>
          ) : (
            <div style={{ display: 'flex', gap: 12 }}>
              <PaybackStat value={paybackJobs.toLocaleString()} label="jobs" />
              <PaybackStat value={Math.ceil(paybackWeeks).toLocaleString()} label="weeks" />
              <PaybackStat value={paybackMonths.toFixed(1)} label="months" />
            </div>
          )}
        </div>

        </div>
      </div>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid var(--rule)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-soft)', borderBottom: '1px solid var(--rule)', background: 'var(--green-pale)' }}>
        {label}
      </div>
      <div>{children}</div>
    </div>
  )
}

function Row({ label, value, onChange }: { label: string; value: number; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid var(--rule)' }}>
      <label style={{ fontSize: 13, color: 'var(--ink)', flex: 1 }}>{label}</label>
      <input
        type="number"
        value={value}
        onChange={onChange}
        style={{ width: 90, textAlign: 'right', border: '1px solid var(--rule)', borderRadius: 6, padding: '4px 8px', fontSize: 13, fontFamily: 'var(--font-body)', color: 'var(--ink)', background: '#fafafa', outline: 'none' }}
      />
    </div>
  )
}

function PaybackStat({ value, label }: { value: string; label: string }) {
  return (
    <div style={{ flex: 1, background: 'var(--green-pale)', border: '1px solid var(--green-light)', borderRadius: 10, padding: '12px', textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, color: 'var(--green-deep)', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
    </div>
  )
}

function ResultRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
      <span style={{ fontSize: 13, color: 'rgba(255,255,255,.6)' }}>{label}</span>
      <div style={{ textAlign: 'right' }}>
        <span style={{ fontSize: 13, color: '#fff', fontWeight: 500 }}>{value}</span>
        {sub && <div style={{ fontSize: 11, color: 'rgba(255,255,255,.3)', marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  )
}
