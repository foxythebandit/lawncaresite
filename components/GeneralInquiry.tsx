'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { submitServiceInquiry, type ServiceInquiryKind } from '@/app/actions/submit-service-inquiry'
import { photonSearch, type GeoResult } from '@/lib/address-search'
import { getAttribution } from '@/lib/attribution'
import { trackWebsiteLead } from '@/lib/meta-events'
import { QUOTE_CONSENT_TEXT } from '@/lib/quote-consent'
import { submissionId } from '@/lib/submission-id'
import styles from './GeneralInquiry.module.css'

const SERVICES: ServiceInquiryKind[] = ['Landscaping', 'Yard cleanup', 'Gutter cleaning', 'Lawn mowing', 'Other']

export default function GeneralInquiry() {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [suggestions, setSuggestions] = useState<GeoResult[]>([])
  const [activeSuggestion, setActiveSuggestion] = useState(-1)
  const suggestionTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suggestionRequest = useRef<AbortController | null>(null)
  const suggestionVersion = useRef(0)
  const addressInput = useRef<HTMLInputElement>(null)
  const [email, setEmail] = useState('')
  const [service, setService] = useState<ServiceInquiryKind | ''>('')
  const [notes, setNotes] = useState('')
  const [consent, setConsent] = useState(false)
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success'>('idle')
  const [error, setError] = useState('')

  function closeSuggestions() {
    suggestionVersion.current++
    if (suggestionTimer.current) clearTimeout(suggestionTimer.current)
    suggestionRequest.current?.abort()
    setSuggestions([])
    setActiveSuggestion(-1)
  }

  function editAddress(value: string) {
    setAddress(value)
    closeSuggestions()
    if (value.trim().length < 3) return
    const version = suggestionVersion.current
    suggestionTimer.current = setTimeout(async () => {
      const request = new AbortController()
      suggestionRequest.current = request
      try {
        const results = await photonSearch(value, 5, request.signal)
        if (version === suggestionVersion.current && document.activeElement === addressInput.current) setSuggestions(results)
      } catch { /* Visitors can always enter their address manually. */ }
    }, 350)
  }

  function pickSuggestion(suggestion: GeoResult) {
    closeSuggestions()
    setAddress(suggestion.label)
  }

  useEffect(() => () => {
    suggestionVersion.current++
    if (suggestionTimer.current) clearTimeout(suggestionTimer.current)
    suggestionRequest.current?.abort()
  }, [])

  function startNewInquiry() {
    closeSuggestions()
    try { sessionStorage.removeItem('qg_submission_service') } catch { /* Storage may be unavailable. */ }
    setName(''); setPhone(''); setAddress(''); setEmail(''); setService(''); setNotes(''); setConsent(false)
    setError(''); setStatus('idle')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!service || status === 'submitting') return
    closeSuggestions()
    setStatus('submitting'); setError('')
    try {
      const result = await submitServiceInquiry({
        submission_id: submissionId('service'), name, phone, address, email, service, notes, consent,
        ...getAttribution(),
      })
      if (!result.success) {
        setStatus('idle'); setError(result.error ?? 'Something went wrong. Please try again.')
        return
      }
      try { sessionStorage.removeItem('qg_submission_service') } catch { /* The inquiry is saved even if storage is unavailable. */ }
      setStatus('success')
      try { trackWebsiteLead(result.eventId) } catch { /* Tracking must not hide a saved inquiry. */ }
    } catch {
      setStatus('idle'); setError('Something went wrong. Please try again.')
    }
  }

  return (
    <section id="service-inquiry" className={styles.section} aria-labelledby="service-inquiry-heading">
      <div className={styles.inner}>
        <div className={styles.intro}>
          <span className={styles.eyebrow}>Have another project in mind?</span>
          <h2 id="service-inquiry-heading">Landscaping &amp; other outdoor projects.</h2>
          <p>Tell us what you have in mind. We&apos;ll call to discuss the scope and a quote.</p>
          <a href="#map-quote" className={styles.mowingLink}>Just need lawn mowing? See your price <span aria-hidden="true">↗</span></a>
        </div>
        <div className={styles.card}>
          {status === 'success' ? (
            <div className={styles.success} role="status">
              <span className={styles.successMark} aria-hidden="true">✓</span>
              <h3>Thanks, we got your project details.</h3>
              <p>We&apos;ll call you to talk through the work and a quote.</p>
              <button type="button" onClick={startNewInquiry}>Start a new inquiry</button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className={styles.form}>
              <div className={styles.formHead}>Tell us about your project</div>
              <div className={styles.grid}>
                <label>Your name <input name="name" type="text" autoComplete="name" required maxLength={150} value={name} onChange={e => setName(e.target.value)} /></label>
                <label>Phone number <input name="phone" type="tel" autoComplete="tel" required maxLength={30} value={phone} onChange={e => setPhone(e.target.value)} /></label>
                <div className={`${styles.wide} ${styles.addressField}`}>
                  <label htmlFor="service-address">Property address</label>
                  <input
                    id="service-address" ref={addressInput} name="address" type="text" autoComplete="off" required maxLength={500}
                    role="combobox" aria-autocomplete="list" aria-expanded={suggestions.length > 0}
                    aria-controls={suggestions.length ? 'service-address-suggestions' : undefined}
                    aria-activedescendant={activeSuggestion >= 0 ? `service-address-option-${activeSuggestion}` : undefined}
                    value={address} onChange={e => editAddress(e.target.value)} onBlur={closeSuggestions}
                    onKeyDown={e => {
                      if (e.key === 'Escape') { closeSuggestions(); return }
                      if (!suggestions.length) return
                      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveSuggestion(i => Math.min(i + 1, suggestions.length - 1)) }
                      else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveSuggestion(i => Math.max(i - 1, -1)) }
                      else if (e.key === 'Enter' && activeSuggestion >= 0) { e.preventDefault(); pickSuggestion(suggestions[activeSuggestion]) }
                    }}
                  />
                  {suggestions.length > 0 && <div id="service-address-suggestions" className={styles.suggestions} role="listbox" aria-label="Suggested addresses">
                    {suggestions.map((suggestion, index) => <div
                      key={`${suggestion.label}-${index}`} id={`service-address-option-${index}`} role="option"
                      aria-selected={index === activeSuggestion} className={styles.suggestion}
                      onPointerDown={e => { e.preventDefault(); pickSuggestion(suggestion) }}
                    >{suggestion.label}</div>)}
                  </div>}
                </div>
                <label>What do you need help with? <select name="service" required value={service} onChange={e => setService(e.target.value as ServiceInquiryKind | '')}>
                  <option value="">Choose a service</option>
                  {SERVICES.map(item => <option key={item} value={item}>{item}</option>)}
                </select></label>
                <label>Email <span className={styles.optional}>(optional)</span> <input name="email" type="email" autoComplete="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} /></label>
                <label className={styles.wide}>Project details <span className={styles.optional}>(optional)</span> <textarea name="notes" rows={4} maxLength={2000} placeholder="What would you like done? Anything we should know about the property?" value={notes} onChange={e => setNotes(e.target.value)} /></label>
              </div>
              <label className={styles.consent}><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> <span>{QUOTE_CONSENT_TEXT} (Optional)</span></label>
              {error && <p className={styles.error} role="alert">{error}</p>}
              <button type="submit" className={styles.submit} disabled={status === 'submitting'}>{status === 'submitting' ? 'Sending…' : 'Send project inquiry'} <span aria-hidden="true">→</span></button>
            </form>
          )}
        </div>
      </div>
    </section>
  )
}
