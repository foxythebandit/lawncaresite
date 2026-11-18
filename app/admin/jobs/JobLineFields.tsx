import type { JobLine } from '@/lib/crm-jobs'

export default function JobLineFields({ lines, setLines }: { lines: JobLine[]; setLines: (lines: JobLine[]) => void }) {
  return <>
    <div className="admin-price-lines">
      {lines.map((line, index) => <div key={index} className="admin-price-line">
        <select aria-label={`Item ${index + 1} type`} value={line.kind} onChange={e => setLines(lines.map((item, i) => i === index ? { ...item, kind: e.target.value as JobLine['kind'] } : item))}><option value="service">Service</option><option value="discount">Discount</option></select>
        <input aria-label={`Item ${index + 1} description`} className="admin-confirm-date-input" required value={line.description} onChange={e => setLines(lines.map((item, i) => i === index ? { ...item, description: e.target.value } : item))} />
        <input aria-label={`Item ${index + 1} amount`} className="admin-confirm-date-input" required type="number" min="0" step=".01" value={line.amount.replace(/^-/, '')} onChange={e => setLines(lines.map((item, i) => i === index ? { ...item, amount: e.target.value } : item))} />
        <button type="button" className="admin-remove" aria-label={`Remove item ${index + 1}`} disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, i) => i !== index))}>×</button>
      </div>)}
    </div>
    <div className="work-visit-actions">
      <button type="button" className="crm-button" onClick={() => setLines([...lines, { kind: 'service', description: '', amount: '0.00' }])}>Add service</button>
      <button type="button" className="crm-button" onClick={() => setLines([...lines, { kind: 'discount', description: 'Discount', amount: '0.00' }])}>Add discount</button>
    </div>
  </>
}
