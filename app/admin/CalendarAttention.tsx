import Link from 'next/link'
import type { CalendarAttention as Counts } from '@/lib/calendar-data'
import { ATTENTION, calendarHref, type AttentionKind, type CalendarContext } from '@/lib/calendar-view'

export default function CalendarAttention({ counts, context }: { counts: Counts; context: CalendarContext }) {
  return <div role="navigation" className="work-cal-attention" aria-label="Visit attention">
    {(Object.keys(ATTENTION) as AttentionKind[]).map(kind => <Link key={kind}
      href={calendarHref({ ...context, attention: context.attention === kind ? undefined : kind, page: undefined })}
      aria-current={context.attention === kind ? 'page' : undefined} data-kind={kind} data-active={counts[kind] > 0}>
      <span>{ATTENTION[kind]}</span><strong>{counts[kind]}</strong>
    </Link>)}
    {counts.catching_up && <p className="crm-muted">The schedule is catching up. Missed dates are included below under Overdue.</p>}
  </div>
}
