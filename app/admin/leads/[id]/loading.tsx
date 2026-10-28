// Lead page v2 footprint: header, Call/Text, chips, then the blocks (left) and map + quote (right).
export default function Loading() {
  return <div className="crm-workspace crm-lead2 crm-skeleton" aria-busy="true" aria-label="Loading">
    <div className="crm-lead2-top"><div className="crm-sk" style={{ width: 64, height: 14 }} /><div className="crm-sk" style={{ width: 48, height: 12 }} /></div>
    <div className="crm-lead2-head">
      <div className="crm-lead2-who"><div className="crm-sk crm-sk-title" style={{ marginBottom: 8 }} /><div className="crm-sk" style={{ width: 120, height: 14 }} /></div>
      <div className="crm-lead2-actions"><div className="crm-sk crm-sk-button" style={{ width: 190, height: 48 }} /><div className="crm-sk crm-sk-button" style={{ height: 48 }} /></div>
    </div>
    <div className="crm-lead-chips">{[48, 80, 96].map(w => <div key={w} className="crm-sk" style={{ width: w, height: 24 }} />)}</div>
    <div className="crm-lead2-grid">
      <div className="crm-lead2-main">{[200, 150, 170, 70].map((h, i) => <div key={i} className="crm-sk" style={{ height: h, borderRadius: 12 }} />)}</div>
      <div className="crm-lead2-side crm-desktop-only" style={{ flexDirection: 'column' }}><div className="crm-sk" style={{ height: 380, borderRadius: 12 }} /><div className="crm-sk" style={{ height: 200, borderRadius: 12 }} /></div>
    </div>
  </div>
}
