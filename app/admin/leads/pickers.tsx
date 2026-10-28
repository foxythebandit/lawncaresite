'use client'

/** Small shared controls for the board prompts and the Log call sheet. Labels only, no sentences. */

const TZ = 'America/Chicago'
export const todayChicago = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ })

function shift(day: string, days: number, months = 0) {
  const date = new Date(`${day}T12:00:00Z`)
  const dayOfMonth = date.getUTCDate()
  if (months) {
    date.setUTCDate(1)
    date.setUTCMonth(date.getUTCMonth() + months)
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
    date.setUTCDate(Math.min(dayOfMonth, last))
  }
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** Check-back quick picks (PLAN.md 3.2): 1 wk · 1 mo · Spring (Mar 1). */
export function checkBackOptions(today = todayChicago()) {
  const year = Number(today.slice(0, 4))
  const spring = today < `${year}-03-01` ? `${year}-03-01` : `${year + 1}-03-01`
  return [
    { label: '1 wk', value: shift(today, 7) },
    { label: '1 mo', value: shift(today, 0, 1) },
    { label: 'Spring', value: spring },
  ]
}

export const shortDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })

export function Choices<T extends string>({ label, options, value, onChange, columns }: {
  label: string; options: readonly { value: T; label: string; hint?: string }[]; value: T | null | undefined
  onChange: (value: T) => void; columns?: number
}) {
  return <div className="crm-choices" role="radiogroup" aria-label={label} style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}>
    {options.map(option => <button key={option.value} type="button" role="radio" aria-checked={value === option.value}
      className="crm-choice" onClick={() => onChange(option.value)}>
      <span>{option.label}</span>{option.hint && <small>{option.hint}</small>}
    </button>)}
  </div>
}

/** 1 wk · 1 mo · Spring · pick date. */
export function CheckBack({ value, onChange, label = 'Check back' }: { value: string; onChange: (value: string) => void; label?: string }) {
  const options = checkBackOptions()
  const preset = options.find(o => o.value === value)
  return <div className="crm-field-group">
    <span className="crm-field-label">{label}</span>
    <div className="crm-choices crm-choices-4" role="radiogroup" aria-label={label}>
      {options.map(option => <button key={option.label} type="button" role="radio" aria-checked={preset?.value === option.value}
        className="crm-choice" onClick={() => onChange(option.value)}>
        <span>{option.label}</span><small>{shortDay(option.value)}</small>
      </button>)}
      <label className={`crm-choice crm-choice-date${value && !preset ? ' is-on' : ''}`}>
        <span>{value && !preset ? shortDay(value) : 'Date'}</span>
        <input type="date" aria-label={`${label} date`} min={todayChicago()} value={value && !preset ? value : ''} onChange={event => onChange(event.target.value)} />
      </label>
    </div>
  </div>
}
