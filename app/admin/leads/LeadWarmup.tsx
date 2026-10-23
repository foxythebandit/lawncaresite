'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { cachedGeocode } from '@/lib/address-search'
import { warmPropertyTiles } from '@/lib/map-imagery'

type FullPrefetch = NonNullable<Parameters<ReturnType<typeof useRouter>['prefetch']>[1]>['kind']

export interface WarmLead { href: string; address: string | null; jobLatLng: { lat: number; lng: number } | null; needsReview: boolean }

// A staff member opens the top lead seconds after an alert. Once the list has
// painted, load the quote map's code and the property's location + imagery so
// that workspace opens on the house instead of waiting on three networks.
export default function LeadWarmup({ leads }: { leads: WarmLead[] }) {
  const router = useRouter()
  const key = JSON.stringify(leads)
  useEffect(() => {
    let alive = true
    // Full-route prefetch right away (not on scroll-into-view); refetch whenever it goes stale.
    const prefetch = (href: string) => router.prefetch(href, { kind: 'full' as FullPrefetch, onInvalidate: () => { if (alive) prefetch(href) } })
    for (const lead of leads) prefetch(lead.href)
    const run = async () => {
      void import('@/components/MapQuoteBuilder')
      void import('maplibre-gl')
      for (const lead of leads) {
        if (!alive) return
        const point = lead.jobLatLng ?? (lead.address && !lead.needsReview ? await cachedGeocode(lead.address).then(hit => hit && { lat: hit.lat, lng: hit.lon }).catch(() => null) : null)
        if (point && alive) warmPropertyTiles(point.lat, point.lng)
      }
    }
    // Safari has no requestIdleCallback; a short timeout still lets the list paint first.
    const ric = window.requestIdleCallback as typeof window.requestIdleCallback | undefined
    const idle = ric ? ric(() => void run(), { timeout: 1500 }) : window.setTimeout(() => void run(), 300)
    return () => { alive = false; if (ric) window.cancelIdleCallback(idle); else clearTimeout(idle) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return null
}
