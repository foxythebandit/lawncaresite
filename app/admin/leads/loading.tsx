// Same footprint as the board so nothing jumps when the cards arrive.
export default function Loading() {
  return <div className="crm-page crm-board-page crm-skeleton" aria-busy="true" aria-label="Loading">
    <div className="crm-board">
      <div className="crm-page-heading crm-board-heading"><div className="crm-sk crm-sk-title" style={{ width: 120, marginBottom: 0 }} /></div>
      <div className="crm-board-chips">{[88, 96, 92, 150, 104, 92].map((w, i) => <div key={i} className="crm-sk crm-sk-chip" style={{ width: w }} />)}</div>
      <div className="crm-board-cols">
        {[0, 1, 2, 3, 4, 5].map(col => <div key={col} className="crm-board-col" data-selected={col === 0 || undefined}>
          <h2><span className="crm-sk" style={{ width: 70, height: 13 }} /></h2>
          <div className="crm-board-cards">{[0, 1, 2].map(i => <div key={i} className="crm-sk crm-sk-card" />)}</div>
        </div>)}
      </div>
    </div>
  </div>
}
