'use client'

import type { IntroChoice } from '@/lib/quote-offer'

export default function IntroPriceChoice({ value, onChange }: {
  value: IntroChoice | null; onChange: (choice: IntroChoice | null) => void
}) {
  return <>
    <p className="crm-hint">There’s a possible customer match. Review their mowing history before quoting the first visit.</p>
    <label className="crm-field">Introductory price
      <select aria-label="Introductory price" value={value ?? ''} required
        onChange={event => onChange((event.target.value || null) as IntroChoice | null)}>
        <option value="">Choose first-visit pricing</option>
        <option value="standard">Use the standard price</option>
        <option value="intro">Confirmed first mow</option>
      </select>
    </label>
  </>
}
