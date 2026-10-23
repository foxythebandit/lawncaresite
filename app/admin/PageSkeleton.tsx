// Instant placeholder shown by loading.tsx while a CRM page renders on the server.
export function PageSkeleton() {
  return <div className="crm-page crm-skeleton" aria-busy="true" aria-label="Loading">
    <div className="crm-sk crm-sk-title" />
    <div className="crm-sk crm-sk-line" style={{ width: '38%' }} />
    <div className="admin-stats">{[0, 1, 2, 3].map(i => <div key={i} className="crm-sk crm-sk-stat" />)}</div>
    <div className="crm-sk-list">{[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="crm-sk crm-sk-row" />)}</div>
  </div>
}

export function WorkspaceSkeleton() {
  return <div className="crm-workspace crm-skeleton" aria-busy="true" aria-label="Loading">
    <div className="crm-sk crm-sk-title" />
    <div className="crm-sk crm-sk-line" style={{ width: '52%' }} />
    <div className="crm-sk-actions">{[0, 1, 2].map(i => <div key={i} className="crm-sk crm-sk-button" />)}</div>
    <div className="crm-workspace-grid">
      <div className="crm-workspace-main"><div className="crm-sk crm-sk-panel" /><div className="crm-sk crm-sk-panel" /></div>
      <div className="crm-workspace-side"><div className="crm-sk crm-sk-panel" /></div>
    </div>
  </div>
}
