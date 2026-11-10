'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import type { CalendarEntry } from '@/lib/calendar-data'
import { addDays, calendarHref, calendarRange, compareVisitTimes, dateLabel, visitHref, visitStatus, visitTime, visitWindow, VISIT_WINDOWS, type CalendarContext } from '@/lib/calendar-view'
import { customerDisplayName } from '@/lib/lead-labels'
import { shortAddress } from '@/lib/lead-summary'
import Icon from './icons'

const WINDOWS = [...VISIT_WINDOWS, 'Mixed times']
export type DisplayVisit = CalendarEntry & { service: string }

function entryKey(visit: DisplayVisit) {
  return visit.booking_id ?? `${visit.agreement_id}_${visit.revision_id}_${visit.cadence_on}`
}

function VisitLink({ visit, context, today, compact, selectedDay, grouped }: {
  visit: DisplayVisit; context: CalendarContext; today: string; compact?: boolean; selectedDay?: string; grouped?: boolean
}) {
  const key = entryKey(visit)
  const name = customerDisplayName(visit)
  const status = visitStatus(visit.visit_status, visit.service_on, today)
  const when = visitTime(visit.visit_time)
  return <Link href={visitHref(visit, calendarHref({ ...context, date: selectedDay ?? visit.service_on }, key))}
    id={compact ? undefined : `calendar-${key}`} prefetch={false}
    className="work-cal-event" data-status={status}
    aria-label={`${name}, ${visit.service}, ${when}, ${status}`}>
    <strong>{grouped ? visit.service : name}</strong>
    <span>{compact ? visit.service : grouped ? when : `${visit.service} · ${when}`}</span>
    {status !== 'Scheduled' && <small>{status === 'Done' && <Icon name="check" size={12} />}{status}</small>}
  </Link>
}

function DayVisits({ visits, context, today, day }: { visits: DisplayVisit[]; context: CalendarContext; today: string; day: string }) {
  if (!visits.length) return <p className="work-cal-empty">No visits</p>
  const groups = new Map<string, DisplayVisit[]>()
  for (const visit of visits) {
    const key = visit.property_id ?? entryKey(visit)
    const group = groups.get(key) ?? []
    group.push(visit)
    groups.set(key, group)
  }
  const sections = new Map<string, DisplayVisit[][]>()
  for (const group of groups.values()) {
    const windows = new Set(group.map(visit => visitWindow(visit.visit_time)))
    const key = windows.size === 1 ? [...windows][0] : 'Mixed times'
    const section = sections.get(key) ?? []
    section.push(group)
    sections.set(key, section)
  }
  return WINDOWS.map(window => {
    const section = sections.get(window)
    if (!section) return null
    return <div key={window} className="work-cal-window">
      {window !== 'Mixed times' && <p>{window}</p>}
      {section.map(group => <div key={entryKey(group[0])} className={group.length > 1 ? 'work-cal-property' : undefined}>
        {group.length > 1 && <div className="work-cal-property-label">
          <strong>{customerDisplayName(group[0])}</strong>
          <small>{group[0].address !== customerDisplayName(group[0]) && shortAddress(group[0].address) ? shortAddress(group[0].address) + ' · ' : ''}{group.length} visits</small>
        </div>}
        {group.map(visit => <VisitLink key={entryKey(visit)} visit={visit} context={context} today={today} selectedDay={day}
          grouped={group.length > 1 && customerDisplayName(visit) === customerDisplayName(group[0])} />)}
      </div>)}
    </div>
  })
}

export default function CalendarView({ context, today, visits, focus }: {
  context: CalendarContext; today: string; visits: DisplayVisit[]; focus?: string
}) {
  const router = useRouter()
  const [selection, setSelection] = useState({ contextDay: context.date, day: context.date })
  const selected = selection.contextDay === context.date ? selection.day : context.date
  const { first, last } = calendarRange(context.view, context.date)
  const dates: string[] = []
  for (let date = first; date <= last; date = addDays(date, 1)) dates.push(date)
  const byDate = new Map<string, DisplayVisit[]>()
  for (const visit of visits) {
    const day = byDate.get(visit.service_on) ?? []
    day.push(visit)
    byDate.set(visit.service_on, day)
  }
  for (const day of byDate.values()) day.sort((a, b) => compareVisitTimes(a.visit_time, b.visit_time))

  function selectDay(day: string) {
    setSelection({ contextDay: context.date, day })
    if (day !== context.date) router.replace(calendarHref({ ...context, date: day }), { scroll: false })
  }

  useEffect(() => {
    if (focus) document.getElementById(`calendar-${focus}`)?.focus()
  }, [context.date, focus])

  if (context.view === 'month') {
    const weekday = new Date(first + 'T12:00:00Z').getUTCDay()
    const pad = (weekday + 6) % 7
    return <div className="work-cal-month">
      <div className="work-cal-month-grid" aria-label="Month">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(label => <span className="work-cal-weekday" key={label}>{label}</span>)}
        {Array.from({ length: pad }, (_, index) => <div key={index} className="work-cal-month-cell is-blank" />)}
        {dates.map(date => {
          const entries = byDate.get(date) ?? []
          const count = entries.length
          return <div key={date} className="work-cal-month-cell" data-selected={date === selected} data-today={date === today}>
            <button type="button" aria-pressed={date === selected}
              aria-label={`${dateLabel(date, { weekday: 'long', month: 'long', day: 'numeric' })}, ${count} ${count === 1 ? 'visit' : 'visits'}`}
              onClick={() => selectDay(date)}>{Number(date.slice(-2))}</button>
            <div className="work-cal-month-preview">
              {entries.slice(0, 2).map(visit => <VisitLink key={entryKey(visit)} visit={visit} context={context} today={today} compact />)}
              {count > 2 && <button className="work-cal-more" type="button" onClick={() => selectDay(date)}>+{count - 2} more</button>}
            </div>
            {count > 0 && <span className="work-cal-month-count" aria-hidden="true">{count}</span>}
          </div>
        })}
      </div>
      <section className="work-cal-month-day" aria-label="Selected day">
        <h3>{dateLabel(selected, { weekday: 'long', month: 'long', day: 'numeric' })}</h3>
        <DayVisits visits={byDate.get(selected) ?? []} context={context} today={today} day={selected} />
      </section>
    </div>
  }

  return <div className={`work-cal-canvas is-${context.view}`} aria-label={`${context.view === 'week' ? 'Week' : 'Day'} calendar`}>
    {dates.map(date => <section key={date} className="work-cal-day" data-today={date === today}
      aria-current={date === today ? 'date' : undefined}
      aria-label={dateLabel(date, { weekday: 'long', month: 'long', day: 'numeric' })}>
      <h3><span>{dateLabel(date, { weekday: context.view === 'week' ? 'short' : 'long' })}</span>
        <strong>{Number(date.slice(-2))}</strong>
        {date === today && <small>Today</small>}
      </h3>
      <DayVisits visits={byDate.get(date) ?? []} context={context} today={today} day={date} />
    </section>)}
  </div>
}
