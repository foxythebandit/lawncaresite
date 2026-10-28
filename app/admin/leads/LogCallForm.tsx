'use client'

import { useState } from 'react'
import { CALL_OUTCOME, CALL_OUTCOMES, CLOSED_REASONS, CLOSED_REASON_LABEL, COLUMN_LABEL, FREQUENCIES, FREQUENCY_LABEL, QUOTED_REASONS,
  QUOTED_REASON_LABEL, type CallOutcome, type ClosedReason, type Frequency, type QuotedReason } from '@/lib/lead-board'
import type { CallDetail } from './board-actions'
import { CheckBack, Choices, todayChicago } from './pickers'

export type LogCallDraft = {
  step: 'not_reached' | 'talked' | null; outcome: CallOutcome | null
  price: string; frequency: Frequency | null; firstVisit: string; checkBack: string; reason: string | null; note: string
}

const stepOptions = [{ value: 'not_reached', label: 'Didn\'t reach' }, { value: 'talked', label: 'Talked' }] as const
const frequencyOptions = FREQUENCIES.map(value => ({ value, label: FREQUENCY_LABEL[value] }))
const quotedOptions = QUOTED_REASONS.map(value => ({ value, label: QUOTED_REASON_LABEL[value] }))
const closedOptions = CLOSED_REASONS.map(value => ({ value, label: CLOSED_REASON_LABEL[value] }))
const ASKS: Record<CallOutcome, string | null> = {
  no_answer: null, voicemail: null, bad_number: null,
  booked: 'Price · frequency · first visit', yes_tbd: 'Price · frequency · set date by', not_now: 'Price · reason · check back', no: 'Reason · price',
}

function cents(text: string): number | null {
  if (!/^\d{1,6}(\.\d{0,2})?$/.test(text.trim())) return null
  const value = Math.round(Number(text) * 100)
  return value > 0 ? value : null
}

/** Log call sheet v2 (PLAN.md 3.2, S11): step 1 Didn't reach / Talked, then one of seven outcomes. */
export default function LogCallForm({ initial, priceCents, frequency, onSave }: {
  initial: LogCallDraft | null; priceCents: number | null; frequency: Frequency | null
  onSave: (outcome: CallOutcome, detail: CallDetail, draft: LogCallDraft) => void
}) {
  const [form, setForm] = useState<LogCallDraft>(() => initial ?? {
    step: null, outcome: null, price: priceCents ? String(priceCents / 100) : '', frequency, firstVisit: '', checkBack: '', reason: null, note: '',
  })
  const set = (changes: Partial<LogCallDraft>) => setForm(current => ({ ...current, ...changes }))
  const outcome = form.outcome
  const price = cents(form.price)
  const needsPrice = outcome === 'booked' || outcome === 'yes_tbd' || outcome === 'not_now'
  const valid = !!outcome && (!needsPrice || !!price) && (outcome !== 'no' || !form.price.trim() || !!price)
    && (outcome !== 'booked' && outcome !== 'yes_tbd' || !!form.frequency)
    && (outcome !== 'booked' || !!form.firstVisit)
    && (outcome !== 'not_now' || (!!form.checkBack && !!form.reason))
    && (outcome !== 'no' || !!form.reason)

  function detail(): CallDetail {
    const d: CallDetail = {}
    if (outcome === 'booked' || outcome === 'yes_tbd' || outcome === 'not_now' || (outcome === 'no' && price)) {
      d.price_cents = price!
      if (form.frequency) d.frequency = form.frequency
    }
    if (outcome === 'booked') d.first_visit_on = form.firstVisit
    if ((outcome === 'not_now' || outcome === 'yes_tbd') && form.checkBack) d.check_back_on = form.checkBack
    if ((outcome === 'not_now' || outcome === 'no') && form.reason) d.reason = form.reason
    if (form.note.trim()) d.note = form.note.trim()
    return d
  }

  return <form className="crm-logcall-form" onSubmit={event => { event.preventDefault(); if (valid) onSave(outcome!, detail(), form) }}>
    <Choices label="Call" options={stepOptions} value={form.step} columns={2}
      onChange={step => set({ step, outcome: form.outcome && CALL_OUTCOME[form.outcome].step === step ? form.outcome : null, reason: null })} />
    {form.step && <div className="crm-outcomes" role="radiogroup" aria-label="Outcome">
      {CALL_OUTCOMES.filter(key => CALL_OUTCOME[key].step === form.step).map(key => <button key={key} type="button" role="radio" aria-checked={outcome === key}
        className="crm-outcome" onClick={() => set({ outcome: key, reason: null, ...(key === 'no' && outcome !== 'no' ? { price: '' } : {}),
          ...(key !== 'no' && outcome === 'no' && !form.price && priceCents ? { price: String(priceCents / 100) } : {}) })}>
        <span className="crm-outcome-main"><span aria-hidden="true">{CALL_OUTCOME[key].icon}</span>{CALL_OUTCOME[key].label}</span>
        <span className="crm-outcome-to">{COLUMN_LABEL[CALL_OUTCOME[key].to]}</span>
        {ASKS[key] && <small>{ASKS[key]}</small>}
      </button>)}
    </div>}

    {outcome && CALL_OUTCOME[outcome].step === 'talked' && <div className="crm-logcall-fields">
      <div className="crm-logcall-row">
        <label className="crm-field crm-price-field">{outcome === 'no' ? 'Price told (optional)' : 'Price'}
          <span className="crm-money-input"><span aria-hidden="true">$</span>
            <input inputMode="decimal" autoComplete="off" value={form.price} onChange={event => set({ price: event.target.value.replace(/[^\d.]/g, '') })} aria-invalid={!!form.price && !price} />
          </span>
        </label>
      </div>
      {(outcome !== 'no' || price) && <>
        <span className="crm-field-label">How often{outcome === 'not_now' || outcome === 'no' ? ' (optional)' : ''}</span>
        <Choices label="How often" options={frequencyOptions} value={form.frequency} onChange={value => set({ frequency: value })} columns={4} />
      </>}
      {outcome === 'booked' && <label className="crm-field crm-date-field">First visit
        <input type="date" min={todayChicago()} value={form.firstVisit} onChange={event => set({ firstVisit: event.target.value })} required />
      </label>}
      {outcome === 'yes_tbd' && <CheckBack label="Set date by (optional)" value={form.checkBack} onChange={value => set({ checkBack: value })} />}
      {outcome === 'not_now' && <>
        <span className="crm-field-label">Reason</span>
        <Choices<QuotedReason> label="Reason" options={quotedOptions} value={form.reason as QuotedReason | null} onChange={value => set({ reason: value })} />
        <CheckBack value={form.checkBack} onChange={value => set({ checkBack: value })} />
      </>}
      {outcome === 'no' && <>
        <span className="crm-field-label">Reason</span>
        <Choices<ClosedReason> label="Reason" options={closedOptions} value={form.reason as ClosedReason | null} onChange={value => set({ reason: value })} />
      </>}
    </div>}

    {outcome && <label className="crm-field crm-note-field">Note (optional)
      <textarea rows={2} maxLength={2000} value={form.note} onChange={event => set({ note: event.target.value })} />
    </label>}
    <div className="crm-dialog-actions crm-logcall-actions">
      <button type="submit" className="crm-button crm-button-primary crm-button-lg" disabled={!valid}>
        {outcome ? `Save · ${COLUMN_LABEL[CALL_OUTCOME[outcome].to]}` : 'Save'}</button>
    </div>
  </form>
}
