declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
  }
}

function trackEvent(name: string, params?: Record<string, unknown>) {
  if (typeof window === 'undefined' || !window.gtag) return
  window.gtag('event', name, params)
}

/**
 * Fires when "Find my property" successfully resolves an address: the GA4
 * funnel event, plus a virtual pageview (same technique as trackQuoteShown
 * below) so this step shows up as its own page in GA4/Ads reporting. The
 * address bar briefly shows /#find-property as proof, then reverts.
 */
export function trackQuoteAddressFound() {
  trackEvent('quote_address_found')

  if (typeof window === 'undefined') return
  const previousUrl = window.location.pathname + window.location.search + window.location.hash

  window.history.pushState({}, '', '/#find-property')
  trackEvent('page_view', {
    page_title: document.title,
    page_location: window.location.origin + '/#find-property',
    page_path: '/#find-property',
  })

  setTimeout(() => {
    window.history.pushState({}, '', previousUrl || '/')
  }, 1000)
}

export function trackQuoteLawnTraced() {
  trackEvent('quote_lawn_traced')
}

/**
 * Fires when the price is revealed: the GA4 funnel event, the Google Ads
 * conversion action, and a virtual pageview so the separately configured
 * Ads "Page view (Page load quietgreen.co/#map-quote)" goal fires too. That
 * goal's match URL is /#map-quote (not /quote — verified directly in Google
 * Ads), so the virtual pageview has to target that exact URL to count. The
 * address bar briefly shows /#map-quote as proof, then reverts.
 */
export function trackQuoteShown() {
  trackEvent('quote_shown')
  trackEvent('conversion', { send_to: 'AW-18401747819/iyUiCJHol_McEOvG0cZE' })

  if (typeof window === 'undefined') return
  const previousUrl = window.location.pathname + window.location.search + window.location.hash

  window.history.pushState({}, '', '/#map-quote')
  trackEvent('page_view', {
    page_title: document.title,
    page_location: window.location.origin + '/#map-quote',
    page_path: '/#map-quote',
  })

  setTimeout(() => {
    window.history.pushState({}, '', previousUrl || '/')
  }, 1000)
}
