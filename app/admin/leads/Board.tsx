'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useOptimistic, useRef, useState, useTransition } from 'react'
import { BOARD_COLUMNS, CLOSED_REASONS, CLOSED_REASON_LABEL, COLUMN_LABEL, QUOTED_REASONS, QUOTED_REASON_LABEL,
  type BoardColumn, type ClosedReason, type QuotedReason } from '@/lib/lead-board'
import { groupBoard, sortColumn, type BoardCard } from './board-cards'
import { moveLead } from './board-actions'
import Sheet from './Sheet'
import { CheckBack, Choices } from './pickers'
import Icon from '../icons'

type FullPrefetch = NonNullable<Parameters<ReturnType<typeof useRouter>['prefetch']>[1]>['kind']
type Prompt = { card: BoardCard; step: 'menu' | 'closed' | 'quoted' }
type Drag = { card: BoardCard; el: HTMLElement; x: number; y: number; touch: boolean; active: boolean; timer?: ReturnType<typeof setTimeout>; ghost?: HTMLElement; over?: HTMLElement | null }

const closedOptions = CLOSED_REASONS.map(value => ({ value, label: CLOSED_REASON_LABEL[value] }))
const quotedOptions = QUOTED_REASONS.map(value => ({ value, label: QUOTED_REASON_LABEL[value] }))

/** Lift a card: a floating copy follows the pointer; the original dims in place. */
function startDrag(d: Drag, container: HTMLElement | null) {
  d.active = true
  const rect = d.el.getBoundingClientRect()
  const ghost = d.el.cloneNode(true) as HTMLElement
  ghost.classList.add('crm-bcard-ghost')
  ghost.removeAttribute('data-card')
  Object.assign(ghost.style, { width: `${rect.width}px`, left: `${rect.left}px`, top: `${rect.top}px` })
  container?.appendChild(ghost)
  d.ghost = ghost
  d.el.setAttribute('data-dragging', '')
  document.documentElement.classList.add('crm-dragging')
  if (d.touch) navigator.vibrate?.(10)
}

export default function Board({ cards, initialView, initialColumn }: { cards: BoardCard[]; initialView: 'board' | 'list'; initialColumn: BoardColumn }) {
  const router = useRouter()
  const [view, setView] = useState(initialView)
  const [selected, setSelected] = useState(initialColumn)
  const [shown, applyMove] = useOptimistic(cards, (state, move: { id: string; column: BoardColumn }) =>
    state.map(card => card.id === move.id ? { ...card, column: move.column } : card))
  const [, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [moved, setMoved] = useState<{ id: string; at: number } | null>(null)
  const [prompt, setPrompt] = useState<Prompt | null>(null)
  const [closedReason, setClosedReason] = useState<ClosedReason | null>(null)
  const [quotedReason, setQuotedReason] = useState<QuotedReason | null>(null)
  const [checkBack, setCheckBack] = useState('')
  const boardRef = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const suppressClick = useRef(false)
  const refocus = useRef<{ id: string; column: BoardColumn } | null>(null)
  const prefetched = useRef(new Set<string>())
  const groups = groupBoard(shown)

  function remember(next: { view?: 'board' | 'list'; col?: BoardColumn }) {
    const url = new URL(location.href)
    if (next.view) { if (next.view === 'list') url.searchParams.set('view', 'list'); else url.searchParams.delete('view') }
    if (next.col) { if (next.col === 'new') url.searchParams.delete('col'); else url.searchParams.set('col', next.col) }
    history.replaceState(history.state, '', url)
  }

  function prefetch(href: string) {
    if (prefetched.current.has(href)) return
    prefetched.current.add(href)
    router.prefetch(href, { kind: 'full' as FullPrefetch })
  }

  function requestMove(card: BoardCard, column: BoardColumn) {
    if (card.column === column) { setPrompt(null); return }
    if (column === 'closed' || column === 'quoted') {
      setClosedReason(null); setQuotedReason(null); setCheckBack('')
      setPrompt({ card, step: column })
      return
    }
    commit(card, column, {})
  }

  function commit(card: BoardCard, column: BoardColumn, detail: Parameters<typeof moveLead>[2]) {
    setPrompt(null); setError('')
    setMoved({ id: card.id, at: Date.now() })
    startTransition(async () => {
      applyMove({ id: card.id, column })
      const result = await moveLead(card.id, column, detail).catch(() => ({ ok: false as const, error: 'Not saved' }))
      if (!result.ok) { setError(`${card.name} not moved · ${result.error}`); setMoved({ id: card.id, at: Date.now() }) }
    })
  }

  // Keep keyboard focus on a card after it moves columns (after any prompt has closed).
  useEffect(() => {
    const want = refocus.current
    if (!want) return
    const link = boardRef.current?.querySelector<HTMLElement>(`[data-drop="${want.column}"] [data-card="${want.id}"] .crm-bcard-link`)
    if (!link) return
    refocus.current = null
    setTimeout(() => { if (link.isConnected) link.focus() }, 220)
  })

  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => setError(''), 6000)
    return () => clearTimeout(timer)
  }, [error])

  // Pointer drag: mouse/pen after a 6px move, touch after a 350ms press (so lists still scroll).
  const requestRef = useRef(requestMove)
  useEffect(() => { requestRef.current = requestMove })
  useEffect(() => {
    const target = (x: number, y: number) => (document.elementFromPoint(x, y)?.closest('[data-drop]') as HTMLElement | null) ?? null
    const end = () => {
      const d = drag.current
      drag.current = null
      if (!d) return
      clearTimeout(d.timer)
      d.ghost?.remove()
      d.el.removeAttribute('data-dragging')
      d.over?.removeAttribute('data-over')
      document.documentElement.classList.remove('crm-dragging')
      return d
    }
    const onMove = (event: PointerEvent) => {
      const d = drag.current
      if (!d) return
      const dx = event.clientX - d.x, dy = event.clientY - d.y
      if (!d.active) {
        if (Math.hypot(dx, dy) > (d.touch ? 10 : 6)) { if (d.touch) end(); else startDrag(d, boardRef.current) }
        if (!d.active) return
      }
      d.ghost!.style.transform = `translate(${dx}px, ${dy}px) rotate(1.5deg)`
      const over = target(event.clientX, event.clientY)
      if (over !== d.over) { d.over?.removeAttribute('data-over'); over?.setAttribute('data-over', ''); d.over = over }
    }
    const onUp = (event: PointerEvent) => {
      const d = end()
      if (!d?.active) return
      suppressClick.current = true
      setTimeout(() => { suppressClick.current = false }, 0)
      const column = target(event.clientX, event.clientY)?.dataset.drop as BoardColumn | undefined
      if (column) requestRef.current(d.card, column)
    }
    const onTouchMove = (event: TouchEvent) => { if (drag.current?.active) event.preventDefault() }
    const onCancel = () => { end() }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('touchmove', onTouchMove)
    }
  }, [])

  function onPointerDown(event: React.PointerEvent<HTMLElement>, card: BoardCard) {
    if (event.button !== 0 || (event.target as Element).closest('button')) return
    prefetch(card.href)
    const d: Drag = { card, el: event.currentTarget, x: event.clientX, y: event.clientY, touch: event.pointerType === 'touch', active: false }
    if (d.touch) d.timer = setTimeout(() => { if (drag.current === d) startDrag(d, boardRef.current) }, 350)
    drag.current = d
  }

  function onKeyDown(event: React.KeyboardEvent, card: BoardCard) {
    if (!event.shiftKey || (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft')) return
    event.preventDefault()
    const index = BOARD_COLUMNS.indexOf(card.column) + (event.key === 'ArrowRight' ? 1 : -1)
    if (index < 0 || index >= BOARD_COLUMNS.length) return
    refocus.current = { id: card.id, column: BOARD_COLUMNS[index] }
    requestMove(card, BOARD_COLUMNS[index])
  }

  const cardView = (card: BoardCard, row = false) => <div key={card.id} className={`crm-bcard${row ? ' crm-bcard-row' : ''}`} data-card={card.id}
    data-moved={moved?.id === card.id ? moved.at : undefined} onPointerDown={event => onPointerDown(event, card)}
    onContextMenu={event => { if (drag.current) event.preventDefault() }}>
    <Link className="crm-bcard-link" href={card.href} prefetch={false} draggable={false}
      aria-keyshortcuts="Shift+ArrowLeft Shift+ArrowRight"
      onPointerEnter={() => prefetch(card.href)} onFocus={() => prefetch(card.href)} onKeyDown={event => onKeyDown(event, card)}
      onClick={event => { if (suppressClick.current) event.preventDefault() }}>
      <span className="crm-bcard-top"><strong>{card.name}</strong><span className="crm-bcard-ago">{card.ago}</span></span>
      {row && <span className={`crm-chip crm-chip-col crm-chip-${card.column}`}>{COLUMN_LABEL[card.column]}</span>}
      <span className={`crm-bcard-headline crm-tone-${card.tone}`}>{card.headline}</span>
      <span className="crm-bcard-meta">{card.meta || '—'}</span>
      {card.value && <span className="crm-bcard-value">{card.value}</span>}
    </Link>
    <button type="button" className="crm-bcard-move" aria-label={`Move ${card.name}`} aria-haspopup="dialog"
      onClick={() => setPrompt({ card, step: 'menu' })}><Icon name="more" size={18} /></button>
  </div>

  return <div className="crm-board" ref={boardRef} data-view={view}>
    <div className="crm-page-heading crm-board-heading">
      <h1>Leads</h1>
      <div className="admin-view-toggle crm-board-toggle" role="group" aria-label="Board view">
        <button type="button" className={`admin-view-btn${view === 'board' ? ' active' : ''}`} aria-pressed={view === 'board'}
          onClick={() => { setView('board'); remember({ view: 'board' }) }}><Icon name="columns" size={15} />Board</button>
        <button type="button" className={`admin-view-btn${view === 'list' ? ' active' : ''}`} aria-pressed={view === 'list'}
          onClick={() => { setView('list'); remember({ view: 'list' }) }}><Icon name="list" size={15} />List</button>
      </div>
    </div>

    <div className="crm-board-chips" role="tablist" aria-label="Columns">
      {BOARD_COLUMNS.map(column => <button key={column} type="button" role="tab" data-drop={column} aria-selected={selected === column}
        className={`crm-board-chip${column === 'booking_request' ? ' is-hot' : ''}${column === 'booking_request' && groups[column].length ? ' has-cards' : ''}`}
        onClick={() => { setSelected(column); remember({ col: column }) }}>
        {COLUMN_LABEL[column]} <strong>{groups[column].length}</strong>
      </button>)}
    </div>

    {view === 'list' ? <div className="crm-board-list" aria-label="All leads">
      {BOARD_COLUMNS.flatMap(column => sortColumn(column, groups[column])).map(card => cardView(card, true))}
      {!shown.length && <p className="crm-board-empty">—</p>}
    </div> : <div className="crm-board-cols">
      {BOARD_COLUMNS.map(column => <section key={column} className={`crm-board-col${column === 'booking_request' ? ' is-hot' : ''}`}
        data-drop={column} data-selected={selected === column || undefined} aria-label={COLUMN_LABEL[column]}>
        <h2><span>{COLUMN_LABEL[column]}</span><strong>{groups[column].length}</strong></h2>
        <div className="crm-board-cards">
          {groups[column].map(card => cardView(card))}
          {!groups[column].length && <p className="crm-board-empty">—</p>}
        </div>
      </section>)}
    </div>}

    <Sheet open={!!prompt} onClose={() => setPrompt(null)}
      title={prompt?.step === 'closed' ? 'Closed · reason' : prompt?.step === 'quoted' ? 'Quoted' : `Move ${prompt?.card.name ?? ''}`}>
      {prompt?.step === 'menu' && <div className="crm-move-list">
        {BOARD_COLUMNS.map(column => <button key={column} type="button" className="crm-move-option" aria-current={prompt.card.column === column || undefined}
          onClick={() => requestMove(prompt.card, column)}>
          <span>{COLUMN_LABEL[column]}</span>{prompt.card.column === column && <small>Now</small>}
        </button>)}
      </div>}
      {prompt?.step === 'closed' && <>
        <Choices label="Reason" options={closedOptions} value={closedReason} onChange={setClosedReason} columns={2} />
        <div className="crm-dialog-actions">
          <button type="button" className="crm-button crm-button-primary crm-button-lg" disabled={!closedReason}
            onClick={() => commit(prompt.card, 'closed', { closed_reason: closedReason! })}>Move to Closed</button>
        </div>
      </>}
      {prompt?.step === 'quoted' && <>
        <span className="crm-field-label">Reason</span>
        <Choices label="Reason" options={quotedOptions} value={quotedReason} onChange={setQuotedReason} columns={2} />
        <CheckBack value={checkBack} onChange={setCheckBack} />
        <div className="crm-dialog-actions">
          <button type="button" className="crm-button crm-button-primary crm-button-lg"
            onClick={() => commit(prompt.card, 'quoted', { ...(quotedReason ? { quoted_reason: quotedReason } : {}), ...(checkBack ? { check_back_on: checkBack } : {}) })}>
            Move to Quoted</button>
        </div>
      </>}
    </Sheet>

    {error && <div className="crm-toast crm-toast-error" role="alert"><span>{error}</span><button type="button" aria-label="Dismiss" onClick={() => setError('')}>×</button></div>}
  </div>
}
