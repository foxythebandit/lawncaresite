/** Website owns website Lead only; ConviFlo owns its own events. Off until explicitly configured. */
export function trackWebsiteLead(eventId?: string) {
  if (process.env.NEXT_PUBLIC_META_LEAD_EVENTS_ENABLED !== 'true' || !eventId || typeof window === 'undefined' || location.pathname.startsWith('/admin') || !window.fbq) return
  const key = `qg_meta_${eventId}`
  if (sessionStorage.getItem(key)) return
  window.fbq('track', 'Lead', {}, { eventID: eventId })
  sessionStorage.setItem(key, '1')
}
