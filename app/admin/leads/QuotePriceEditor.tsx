'use client'

import { useState } from 'react'

export interface ManualPriceLine {
  id: string
  service: string
  amountCents: number
}

function dollarText(cents: number) {
  return (cents / 100).toFixed(2)
}

function centsFromText(value: string) {
  if (!/^\d{1,6}(?:\.\d{0,2})?$/.test(value)) return null
  const [dollars, fraction = ''] = value.split('.')
  return Number(dollars) * 100 + Number(fraction.padEnd(2, '0'))
}

function MoneyInput({ cents, onChange, label }: { cents: number; onChange: (cents: number) => void; label: string }) {
  const [text, setText] = useState(dollarText(cents))
  return <input
    aria-label={label}
    inputMode="decimal"
    value={text}
    onChange={event => {
      const next = event.target.value
      if (next && !/^\d{0,6}(?:\.\d{0,2})?$/.test(next)) return
      setText(next)
      const parsed = centsFromText(next)
      if (parsed !== null) onChange(parsed)
      else if (!next) onChange(0)
    }}
    onBlur={() => setText(dollarText(cents))}
  />
}

export default function QuotePriceEditor({
  lines, onLinesChange, discountCents, onDiscountChange, includeMowing, onIncludeMowingChange,
  mowingPriceCents,
}: {
  lines: ManualPriceLine[]
  onLinesChange: (lines: ManualPriceLine[]) => void
  discountCents: number
  onDiscountChange: (cents: number) => void
  includeMowing: boolean
  onIncludeMowingChange: (included: boolean) => void
  mowingPriceCents: number
}) {
  const subtotalCents = (includeMowing ? mowingPriceCents : 0) + lines.reduce((sum, line) => sum + line.amountCents, 0)
  const totalCents = Math.max(0, subtotalCents - discountCents)
  return <div className="crm-price-editor">
    <h3>Services and price per visit</h3>
    <label className="crm-price-mowing">
      <input type="checkbox" checked={includeMowing} onChange={event => onIncludeMowingChange(event.target.checked)} />
      <span>Include measured lawn care</span>
      <strong>${dollarText(mowingPriceCents)}</strong>
    </label>
    <div className="crm-price-list">
      {lines.map(line => <div className="crm-price-row" key={line.id}>
        <label className="crm-field">Service
          <input value={line.service} maxLength={120} onChange={event => onLinesChange(lines.map(item => item.id === line.id ? { ...item, service: event.target.value } : item))} placeholder="Leaf cleanup, gutters…" />
        </label>
        <label className="crm-field">Price ($)
          <MoneyInput cents={line.amountCents} label={`${line.service || 'Service'} price`} onChange={amountCents => onLinesChange(lines.map(item => item.id === line.id ? { ...item, amountCents } : item))} />
        </label>
        <button type="button" className="crm-price-remove" aria-label={`Remove ${line.service || 'service'}`} onClick={() => onLinesChange(lines.filter(item => item.id !== line.id))}>×</button>
      </div>)}
    </div>
    <button type="button" className="crm-price-add" onClick={() => onLinesChange([...lines, { id: crypto.randomUUID(), service: '', amountCents: 0 }])}>+ Add service</button>
    <label className="crm-field crm-discount-field">Discount ($)
      <MoneyInput cents={discountCents} label="Discount amount" onChange={onDiscountChange} />
    </label>
    <div className="crm-price-total"><span>Total per visit</span><span>${dollarText(totalCents)}</span></div>
    {discountCents > subtotalCents && <p className="crm-feedback" role="alert">Discount cannot exceed the service total.</p>}
  </div>
}
