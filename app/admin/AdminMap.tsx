'use client'

import { useEffect, useRef, useState } from 'react'

interface BookingPin {
  id: string
  name: string
  address: string
  status: string
  price_per_visit: number | null
}

interface GeocodedPin extends BookingPin {
  lat: number
  lng: number
}

const STATUS_COLOR: Record<string, string> = {
  confirmed: '#52b788',
  pending:   '#f5a623',
  declined:  '#e05252',
}

export default function AdminMap({ bookings }: { bookings: BookingPin[] }) {
  const containerRef   = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<import('leaflet').Map | null>(null)
  const [pins, setPins]       = useState<GeocodedPin[]>([])
  const [geocoding, setGeocoding] = useState(true)
  const didGeocode = useRef(false)

  // Geocode on mount
  useEffect(() => {
    if (didGeocode.current) return
    didGeocode.current = true

    const run = async () => {
      const results: GeocodedPin[] = []
      for (const b of bookings.filter(b => b.status !== 'declined')) {
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(b.address)}&limit=1`,
            { headers: { 'Accept-Language': 'en' } }
          )
          const data = await res.json()
          if (data[0]) results.push({ ...b, lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) })
          await new Promise(r => setTimeout(r, 250))
        } catch { /* skip */ }
      }
      setPins(results)
      setGeocoding(false)
    }
    run()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Init / refresh map when pins arrive
  useEffect(() => {
    if (!containerRef.current || geocoding) return

    let mounted = true

    const initMap = async () => {
      const L = (await import('leaflet')).default

      if (!mounted || !containerRef.current) return

      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
      }

      const map = L.map(containerRef.current, { zoomControl: true, scrollWheelZoom: false })
      mapInstanceRef.current = map

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19,
      }).addTo(map)

      if (pins.length === 0) {
        map.setView([39.5, -98.35], 4)
        return
      }

      const markers: import('leaflet').Marker[] = []
      pins.forEach(p => {
        const color = STATUS_COLOR[p.status] ?? '#888'
        const icon = L.divIcon({
          className: '',
          html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.4)"></div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
          popupAnchor: [0, -10],
        })
        const m = L.marker([p.lat, p.lng], { icon })
          .addTo(map)
          .bindPopup(
            `<div style="font-family:sans-serif;font-size:13px;min-width:130px">
              <div style="font-weight:600;margin-bottom:2px">${p.name}</div>
              <div style="color:#4a5e54;font-size:12px;margin-bottom:4px">${p.address}</div>
              <span style="color:${color};font-weight:500;text-transform:capitalize;font-size:12px">${p.status}</span>
              ${p.price_per_visit ? `<span style="color:#888;font-size:12px"> · $${p.price_per_visit}/visit</span>` : ''}
            </div>`,
            { maxWidth: 220 }
          )
        markers.push(m)
      })

      const group = L.featureGroup(markers)
      map.fitBounds(group.getBounds().pad(0.3))
    }

    initMap()

    return () => {
      mounted = false
      mapInstanceRef.current?.remove()
      mapInstanceRef.current = null
    }
  }, [pins, geocoding])

  const confirmedAddresses = bookings
    .filter(b => b.status === 'confirmed')
    .map(b => encodeURIComponent(b.address))
    .join('/')
  const googleMapsUrl = confirmedAddresses ? `https://www.google.com/maps/dir/${confirmedAddresses}` : null

  const confirmedCount = pins.filter(p => p.status === 'confirmed').length
  const pendingCount   = pins.filter(p => p.status === 'pending').length

  return (
    <div className="admin-map-panel">
      <div className="admin-map-header">
        <div className="admin-map-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          Clients
        </div>
        <div className="admin-map-legend">
          {geocoding
            ? <span className="admin-map-locating">Locating…</span>
            : <>
                <span className="admin-map-leg"><span className="admin-map-dot confirmed" />{confirmedCount} confirmed</span>
                <span className="admin-map-leg"><span className="admin-map-dot pending" />{pendingCount} pending</span>
              </>
          }
        </div>
        {googleMapsUrl && (
          <a href={googleMapsUrl} target="_blank" rel="noopener noreferrer" className="admin-map-route-btn">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
            Route
          </a>
        )}
      </div>
      <div ref={containerRef} className="admin-map-canvas" style={{ height: '420px', width: '100%', display: 'block' }}>
        {geocoding && (
          <div className="admin-map-loading">
            <span>Locating clients…</span>
          </div>
        )}
      </div>
    </div>
  )
}
