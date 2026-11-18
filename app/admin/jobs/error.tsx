'use client'

export default function CalendarError({ reset }: { reset: () => void }) {
  return <div className="crm-page">
    <h1>Couldn’t load this page</h1>
    <p className="crm-muted">Try again to reload the calendar or visit.</p>
    <button type="button" className="crm-button" onClick={reset}>Try again</button>
  </div>
}
