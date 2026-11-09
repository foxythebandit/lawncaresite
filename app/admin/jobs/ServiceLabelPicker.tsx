'use client'

import { useRef, useState, useTransition } from 'react'
import { uuid } from '@/lib/uuid'
import type { ServiceLabel } from '@/lib/service-schedules'
import { saveServiceLabel } from './schedule-actions'

export default function ServiceLabelPicker({ labels, value, onChange, locked = false, required = true }: {
  labels: ServiceLabel[]; value: string; onChange: (id: string) => void; locked?: boolean; required?: boolean
}) {
  const [options, setOptions] = useState(labels)
  const [editor, setEditor] = useState<'new' | 'edit' | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [retiring, setRetiring] = useState(false)
  const [busy, startTransition] = useTransition()
  const operation = useRef<{ key: string; id: string } | null>(null)
  const selected = options.find(label => label.id === value)
  function open(mode: 'new' | 'edit') {
    setEditor(mode); setName(mode === 'new' ? '' : selected?.name ?? ''); setError(''); setRetiring(false)
  }
  function save(retire = false) {
    const label = editor === 'edit' ? selected : null
    const key = JSON.stringify([label?.id, label?.updated_at, name, retire])
    if (operation.current?.key !== key) operation.current = { key, id: uuid() }
    const operationId = operation.current.id
    setError('')
    startTransition(async () => {
      try {
        const result = await saveServiceLabel({ id: label?.id, version: label?.updated_at, name, retire, operationId })
        if (!result.ok) { setError(result.error); return }
        setOptions(prior => [...prior.filter(item => item.id !== result.label.id), result.label]
          .sort((a, b) => a.name.localeCompare(b.name)))
        onChange(result.label.retired_at ? '' : result.label.id)
        setEditor(null)
      } catch {
        setError('The label request did not finish. Retry to check the same request.')
      }
    })
  }
  return <div className="service-label-field">
    <label className="crm-field">Service label
      <select value={value} onChange={event => { onChange(event.target.value); setEditor(null) }} disabled={locked || busy} required={required}>
        <option value="">{required ? 'Choose a service' : 'Keep saved service description'}</option>
        {options.filter(label => !label.retired_at || label.id === value).map(label =>
          <option value={label.id} key={label.id}>{label.name}{label.retired_at ? ' (retired)' : ''}</option>)}
      </select>
    </label>
    {!locked && !editor && <div className="work-visit-actions">
      <button type="button" className="crm-button crm-button-sm" onClick={() => open('new')}>New label</button>
      {selected && !selected.retired_at && <button type="button" className="crm-button crm-button-sm" onClick={() => open('edit')}>Manage selected label</button>}
    </div>}
    {editor && <div className="service-editor-subsection">
      <label className="crm-field">Label name<input value={name} onChange={event => setName(event.target.value)} maxLength={120} autoComplete="off" /></label>
      {retiring && <p>Retire this label from new service choices? Saved visits keep their descriptions.</p>}
      {error && <p className="work-visit-error" role="alert">{error}</p>}
      <div className="work-visit-actions">
        <button type="button" className="crm-button crm-button-primary" disabled={busy || !name.trim()} onClick={() => save(retiring)}>
          {retiring ? 'Retire label' : editor === 'new' ? 'Create label' : 'Save label'}
        </button>
        {editor === 'edit' && !retiring && <button type="button" className="crm-button" disabled={busy} onClick={() => setRetiring(true)}>Retire…</button>}
        <button type="button" className="crm-button" disabled={busy} onClick={() => setEditor(null)}>Close label editor</button>
      </div>
    </div>}
  </div>
}
