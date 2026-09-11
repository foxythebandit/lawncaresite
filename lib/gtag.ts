declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
  }
}

function trackEvent(name: string, params?: Record<string, unknown>) {
  if (typeof window === 'undefined' || !window.gtag) return
  window.gtag('event', name, params)
}

export function trackQuoteAddressFound() {
  trackEvent('quote_address_found')
}

export function trackQuoteLawnTraced() {
  trackEvent('quote_lawn_traced')
}

/**
 * Fires when the price is revealed: the GA4 funnel event, the Google Ads
 * conversion action, and a virtual /quote pageview so the separately
 * configured Ads "Page view (Page load .../quote)" goal fires too. The
 * address bar briefly shows /quote as proof, then reverts — app/quote/page.tsx
 * redirects home as a safety net if someone refreshes mid-window or an ad
 * preview crawler hits it directly.
 */
export function trackQuoteShown() {
  trackEvent('quote_shown')
  trackEvent('conversion', { send_to: 'AW-18401747819/iyUiCJHol_McEOvG0cZE' })

  if (typeof window === 'undefined') return
  const previousUrl = window.location.pathname + window.location.search + window.location.hash

  window.history.pushState({}, '', '/quote')
  trackEvent('page_view', {
    page_title: document.title,
    page_location: window.location.origin + '/quote',
    page_path: '/quote',
  })

  setTimeout(() => {
    window.history.pushState({}, '', previousUrl || '/')
  }, 1000)
}
