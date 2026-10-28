'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Bottom sheet on phones, centered dialog on desktop (PLAN.md 6.2 "Smooth"). Native <dialog> gives
 * focus trapping, Escape and an inert page behind it; CSS animates open/close (off for reduced motion).
 */
export default function Sheet({ open, onClose, title, children, className = '' }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode; className?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [mounted, setMounted] = useState(open)
  const [closing, setClosing] = useState(false)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  useEffect(() => {
    const dialog = ref.current
    if (open) {
      /* eslint-disable react-hooks/set-state-in-effect -- the dialog's open state follows the prop */
      setMounted(true); setClosing(false)
      if (dialog && !dialog.open) dialog.showModal()
      return
    }
    if (!dialog?.open) { setMounted(false); return }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { dialog.close(); setMounted(false); return }
    setClosing(true)
    /* eslint-enable react-hooks/set-state-in-effect */
    const timer = setTimeout(() => { dialog.close(); setClosing(false); setMounted(false) }, 180)
    return () => clearTimeout(timer)
  }, [open])

  return <dialog ref={ref} className={`crm-dialog${closing ? ' is-closing' : ''} ${className}`} aria-label={title}
    onCancel={event => { event.preventDefault(); onCloseRef.current() }}
    onClick={event => { if (event.target === event.currentTarget) onCloseRef.current() }}>
    {mounted && <div className="crm-dialog-body">
      <div className="crm-dialog-head">
        <h2>{title}</h2>
        <button type="button" className="crm-dialog-close" aria-label="Close" onClick={() => onCloseRef.current()}>×</button>
      </div>
      {children}
    </div>}
  </dialog>
}
