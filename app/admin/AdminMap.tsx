'use client'

import { useEffect, useRef, useState } from 'react'
import Icon from './icons'

interface BookingPin {
  id: string
  name: string
  address: string
  status: string
  price_per_visit: number | null
  confirmed_date?: string | null
  confirmed_time?: string | null
}

const textForPopup = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

interface GeocodedPin extends BookingPin {
  lat: number
  lng: number
}

const STATUS_COLOR: Record<string, string> = {
  confirmed: '#52b788',
  completed: '#87918b',
}

export default function AdminMap({ bookings }: { bookings: BookingPin[] }) {
  const containerRef   = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<import('leaflet').Map | null>(null)
  const [pins, setPins]       = useState<GeocodedPin[]>([])
  const [geocoding, setGeocoding] = useState(true)
  const didGeocode = useRef(false)

  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)

  // Geocode only after staff opens this bounded calendar map.
  useEffect(() => {
    if (!open || didGeocode.current) return
    didGeocode.current = true

    const run = async () => {
      const results: GeocodedPin[] = []
      for (const b of bookings) {
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
  }, [bookings, open])

  // Init / refresh map when pins arrive
  useEffect(() => {
    if (!open || !containerRef.current || geocoding) return

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
              <div style="font-weight:600;margin-bottom:2px">${textForPopup(p.name)}</div>
              <div style="color:#4a5e54;font-size:12px;margin-bottom:4px">${textForPopup(p.address)}</div>
              <span style="color:${color};font-weight:500;text-transform:capitalize;font-size:12px">${p.status === 'confirmed' ? 'Scheduled' : 'Done'}</span>
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

    const onResize = () => mapInstanceRef.current?.invalidateSize()
    window.addEventListener('resize', onResize)

    return () => {
      mounted = false
      window.removeEventListener('resize', onResize)
      mapInstanceRef.current?.remove()
      mapInstanceRef.current = null
    }
  }, [open, pins, geocoding])

  // Route only today's scheduled visits, in arrival-time order (not every date at once).
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const todayStops = bookings
    .filter(b => b.status === 'confirmed' && b.confirmed_date === today)
    .sort((a, b) => (a.confirmed_time ?? '99:99').localeCompare(b.confirmed_time ?? '99:99'))
    .map(b => encodeURIComponent(b.address))
  const googleMapsUrl = todayStops.length > 1 ? `https://www.google.com/maps/dir/${todayStops.join('/')}`
    : todayStops.length === 1 ? `https://maps.google.com/?q=${todayStops[0]}` : null

  const confirmedCount = pins.filter(p => p.status === 'confirmed').length
  const completedCount = pins.filter(p => p.status === 'completed').length

  return (
    <>
    {open && <link rel="stylesheet" href="/leaflet.css" />}

    <button type="button" className="crm-button" ref={trigger} onClick={() => setOpen(!open)}
      aria-expanded={open} aria-controls="calendar-map"><Icon name="map" size={15} />Map</button>

    <div id="calendar-map" aria-hidden={!open} inert={!open}
      className={`admin-map-panel ${open ? 'admin-map-panel-open' : ''}`}>
      <div className="admin-map-header">
        <div className="admin-map-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          Calendar map
        </div>
        <div className="admin-map-legend">
          {geocoding
            ? <span className="admin-map-locating">Locating…</span>
            : <>
                <span className="admin-map-leg"><span className="admin-map-dot confirmed" />{confirmedCount} scheduled</span>
                <span className="admin-map-leg"><span className="admin-map-dot completed" />{completedCount} done</span>
              </>
          }
        </div>
        {googleMapsUrl && (
          <a href={googleMapsUrl} target="_blank" rel="noopener noreferrer" className="admin-map-route-btn">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
            Today’s route
          </a>
        )}
        <button
          type="button"
          className="admin-map-close"
          onClick={() => { setOpen(false); trigger.current?.focus() }}
          aria-label="Hide map"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div ref={containerRef} className="admin-map-canvas">
        {geocoding && (
          <div className="admin-map-loading">
            <span>Locating clients…</span>
          </div>
        )}
      </div>
    </div>
    </>
  )
}
