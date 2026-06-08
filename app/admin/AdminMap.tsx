'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

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
  const [geocoding, setGeocoding] = useState(false)
  const [show, setShow]       = useState(false)
  const geocodedRef = useRef(false)

  const geocodeAll = useCallback(async () => {
    if (geocodedRef.current) return
    geocodedRef.current = true
    setGeocoding(true)
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
      } catch { /* skip failed geocodes */ }
    }
    setPins(results)
    setGeocoding(false)
  }, [bookings])

  useEffect(() => {
    if (!show || !containerRef.current) return

    let mounted = true

    import('leaflet').then(L => {
      if (!mounted || !containerRef.current) return

      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
      }

      // Leaflet needs its CSS — inject once
      if (!document.getElementById('leaflet-css')) {
        const link = document.createElement('link')
        link.id   = 'leaflet-css'
        link.rel  = 'stylesheet'
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
        document.head.appendChild(link)
      }

      const map = L.map(containerRef.current, { zoomControl: true })
      mapInstanceRef.current = map

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
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
          html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:2.5px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.35)"></div>`,
          iconSize: [16, 16],
          iconAnchor: [8, 8],
          popupAnchor: [0, -10],
        })
        const marker = L.marker([p.lat, p.lng], { icon })
          .addTo(map)
          .bindPopup(`
            <div style="font-family:sans-serif;min-width:140px">
              <div style="font-weight:600;font-size:14px;margin-bottom:3px">${p.name}</div>
              <div style="font-size:12px;color:#4a5e54;margin-bottom:4px">${p.address}</div>
              <div style="display:flex;align-items:center;gap:6px;font-size:12px">
                <span style="color:${color};font-weight:500;text-transform:capitalize">${p.status}</span>
                ${p.price_per_visit ? `<span style="color:#888">· $${p.price_per_visit}/visit</span>` : ''}
              </div>
            </div>
          `)
        markers.push(marker)
      })

      const group = L.featureGroup(markers)
      map.fitBounds(group.getBounds().pad(0.25))
    })

    return () => {
      mounted = false
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
      }
    }
  }, [show, pins])

  // Re-render markers when pins update while map is open
  useEffect(() => {
    if (!show || !mapInstanceRef.current || pins.length === 0) return
    // Map will re-init from the show+pins effect above when pins change
  }, [pins, show])

  const confirmedAddresses = bookings
    .filter(b => b.status === 'confirmed')
    .map(b => encodeURIComponent(b.address))
    .join('/')

  const googleMapsUrl = confirmedAddresses ? `https://www.google.com/maps/dir/${confirmedAddresses}` : null

  return (
    <div className="admin-map-wrap">
      <div className="admin-map-bar">
        <button
          className={`admin-map-toggle${show ? ' active' : ''}`}
          onClick={() => {
            const next = !show
            setShow(next)
            if (next) geocodeAll()
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
            <circle cx="12" cy="10" r="3"/>
          </svg>
          Client map
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: show ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>

        {geocoding && <span className="admin-map-status">Locating clients…</span>}
        {!geocoding && pins.length > 0 && (
          <span className="admin-map-status">
            <span className="admin-map-dot confirmed" /> {pins.filter(p => p.status === 'confirmed').length} confirmed
            &nbsp;&nbsp;
            <span className="admin-map-dot pending" /> {pins.filter(p => p.status === 'pending').length} pending
          </span>
        )}

        {googleMapsUrl && (
          <a href={googleMapsUrl} target="_blank" rel="noopener noreferrer" className="admin-map-route-btn">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
            Plan route
          </a>
        )}
      </div>

      {show && <div ref={containerRef} className="admin-map-canvas" />}
    </div>
  )
}
