export default function IncludedBand() {
  return (
    <div className="included-row included-row--standalone reveal">
      <div className="included-label">Every visit includes</div>
      <div className="included-items">
        {['Full mow', 'Crisp edging', 'Clipping blowdown', 'Complete cleanup'].map(item => (
          <div key={item} className="included-item">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 8.5l4 4 8-8" />
            </svg>
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
