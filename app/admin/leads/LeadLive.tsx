'use client'

import { createContext, useContext, useEffect, useOptimistic, useRef, useState, useTransition } from 'react'
import { CALL_OUTCOME, COLUMN_LABEL, type BoardColumn, type CallOutcome, type Frequency } from '@/lib/lead-board'
import { columnChip, type Chip } from '@/lib/lead-summary'
import { logCall, type CallDetail } from './board-actions'
import LogCallForm, { type LogCallDraft } from './LogCallForm'
import Sheet from './Sheet'
import Icon from '../icons'

type Live = { column: BoardColumn; openLogCall: () => void }
const LiveContext = createContext<Live | null>(null)
const useLive = () => useContext(LiveContext)!

/**
 * Lead page state that changes before the server answers (PLAN.md 6.2 "Instant feedback"): the
 * column chip moves as soon as a call is logged and snaps back with an error if the save fails.
 */
export function LeadLive({ leadId, name, column, priceCents, frequency, children }: {
  leadId: string; name: string; column: BoardColumn; priceCents: number | null; frequency: Frequency | null; children: React.ReactNode
}) {
  const [shownColumn, setColumn] = useOptimistic(column)
  const [, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<LogCallDraft | null>(null)
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null)
  const operation = useRef<{ key: string; id: string } | null>(null)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), toast.error ? 7000 : 3500)
    return () => clearTimeout(timer)
  }, [toast])

  function save(outcome: CallOutcome, detail: CallDetail, form: LogCallDraft) {
    // Same content as a failed attempt reuses its operation ID, so a lost response never logs twice.
    const key = JSON.stringify([outcome, detail])
    if (operation.current?.key !== key) operation.current = { key, id: crypto.randomUUID() }
    const operationId = operation.current.id
    const to = CALL_OUTCOME[outcome].to
    setOpen(false); setDraft(form)
    setToast({ text: `${CALL_OUTCOME[outcome].label} · ${COLUMN_LABEL[to]}` })
    startTransition(async () => {
      setColumn(to)
      const result = await logCall(leadId, operationId, outcome, detail).catch(() => ({ ok: false as const, error: 'Not saved' }))
      if (result.ok) {
        operation.current = null; setDraft(null)
        if ('warning' in result && result.warning) setToast({ text: result.warning, error: true })
      }
      else { setToast({ text: `Call not saved · ${result.error}`, error: true }); setOpen(true) }
    })
  }

  return <LiveContext.Provider value={{ column: shownColumn, openLogCall: () => setOpen(true) }}>
    {children}
    <Sheet open={open} onClose={() => setOpen(false)} title={`Log call · ${name}`} className="crm-logcall">
      <LogCallForm initial={draft} priceCents={priceCents} frequency={frequency} onSave={save} />
    </Sheet>
    {toast && <div className={`crm-toast${toast.error ? ' crm-toast-error' : ''}`} role={toast.error ? 'alert' : 'status'}>
      <span>{toast.text}</span><button type="button" aria-label="Dismiss" onClick={() => setToast(null)}>×</button>
    </div>}
  </LiveContext.Provider>
}

/** Status chips from summarizeLead; the column chip follows an optimistic move. */
export function LeadChips({ chips }: { chips: Chip[] }) {
  const { column } = useLive()
  const shown = chips.map(chip => chip.key === 'column' ? columnChip(column) : chip)
  return <div className="crm-lead-chips">{shown.map(chip => <span key={chip.key} className={`crm-pill crm-pill-${chip.tone}`}>{chip.label}</span>)}</div>
}

export function LogCallButton({ className = 'crm-button', children }: { className?: string; children?: React.ReactNode }) {
  const { openLogCall } = useLive()
  return <button type="button" className={className} onClick={openLogCall}>{children ?? <><Icon name="note" size={16} />Log call</>}</button>
}

/** Messages wants `&body=` on iPhone and `?body=` elsewhere. */
export function TextLink({ phone, body, className, children }: { phone: string; body: string; className?: string; children: React.ReactNode }) {
  return <a className={className} href={`sms:${phone}?body=${encodeURIComponent(body)}`}
    onClick={event => { if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) event.currentTarget.href = `sms:${phone}&body=${encodeURIComponent(body)}` }}>{children}</a>
}

export function CopyText({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return <button type="button" className="crm-copy" aria-label={`Copy ${label}`} onClick={async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* selection fallback: text is visible */ }
  }}>{copied ? 'Copied' : text}</button>
}

/** Plays a call recording from the staff-only audio route without leaving the page. */
export function RecordingButton({ src }: { src: string }) {
  const audio = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  useEffect(() => () => { audio.current?.pause() }, [])
  return <button type="button" className="crm-recording" aria-label={playing ? 'Pause recording' : 'Play recording'} onClick={() => {
    audio.current ??= Object.assign(new Audio(src), { onended: () => setPlaying(false), onpause: () => setPlaying(false), onplay: () => setPlaying(true) })
    if (audio.current.paused) void audio.current.play().catch(() => setPlaying(false)); else audio.current.pause()
  }}><Icon name={playing ? 'pause' : 'play'} size={13} />{playing ? 'Pause' : 'Recording'}</button>
}
