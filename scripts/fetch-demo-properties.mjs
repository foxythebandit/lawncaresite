#!/usr/bin/env node
// One-time helper for scripts/seed-demo-leads.mjs: picks real houses for the demo leads and traces
// one plausible front-yard lawn on each, so lead pages show a sensible map. Writes
// scripts/demo-properties.json, which the seed reads (seeding itself stays offline).
//
//   node scripts/fetch-demo-properties.mjs
//
// Data: OpenStreetMap via the Overpass API (house footprints with an address, residential streets).
// The lawn is the strip between the house front and the curb, as wide as the house plus a little.
import { readFileSync, writeFileSync } from 'node:fs'

const SEED = readFileSync(new URL('./seed-demo-leads.mjs', import.meta.url), 'utf8')
const CITY = {
  roundrock: { at: [30.5083, -97.6789], town: 'Round Rock', zip: '78664' },
  cedarpark: { at: [30.5052, -97.8203], town: 'Cedar Park', zip: '78613' },
  pflugerville: { at: [30.4394, -97.62], town: 'Pflugerville', zip: '78660' },
  north: { at: [30.396, -97.728], town: 'Austin', zip: '78759' },
  south: { at: [30.205, -97.792], town: 'Austin', zip: '78745' },
  east: { at: [30.27, -97.71], town: 'Austin', zip: '78721' },
  libertyhill: { at: [30.6649, -97.9225], town: 'Liberty Hill', zip: '78642' },
}

// Every spec with a property: website map leads (address) and ConviFlo leads with a street.
const specs = [...SEED.matchAll(/\{ n: (\d+),[^\n]*?city: '([a-z]+)'[^\n]*?(?:address|street): '/g)].map(m => ({ n: Number(m[1]), city: m[2] }))
const unique = [...new Map(specs.map(s => [s.n, s])).values()]

// Public Overpass servers fill up; try each, backing off between rounds.
const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']
async function overpass(query) {
  for (let round = 0; round < 4; round++) {
    for (const server of SERVERS) {
      const res = await fetch(server, { method: 'POST', headers: { 'User-Agent': 'quietgreen-demo-seed/1.0' },
        body: new URLSearchParams({ data: `[out:json][timeout:90];${query}` }), signal: AbortSignal.timeout(120000) }).catch(() => null)
      if (res?.ok) return (await res.json()).elements
    }
    await new Promise(r => setTimeout(r, 5000 * 2 ** round))
  }
  throw new Error('Overpass failed')
}

const out = {}
for (const [key, city] of Object.entries(CITY)) {
  const wanted = unique.filter(s => s.city === key).sort((a, b) => a.n - b.n)
  if (!wanted.length) continue
  const [lat0, lng0] = city.at
  const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540
  const xy = (p) => [(p.lon - lng0) * kx, (p.lat - lat0) * ky]
  const ll = ([x, y]) => [Math.round((lng0 + x / kx) * 1e6) / 1e6, Math.round((lat0 + y / ky) * 1e6) / 1e6]

  /** Detached houses whose nearest named residential street is their own address street, each with a front lawn. */
  function usable(houses, roads) {
    const segments = roads.flatMap(r => r.geometry.slice(1).map((p, i) => [xy(r.geometry[i]), xy(p), r.tags.name]))
    const nearest = ([px, py]) => {
      let best = null
      for (const [[ax, ay], [bx, by], name] of segments) {
        const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)))
        const x = ax + t * dx, y = ay + t * dy, d = Math.hypot(px - x, py - y)
        if (!best || d < best.d) best = { x, y, d, name }
      }
      return best
    }
    const found = []
    for (const h of [...houses].sort((a, b) => a.id - b.id)) {
      const pts = h.geometry.slice(0, -1).map(xy)
      if (pts.length < 4) continue
      const area = Math.abs(pts.reduce((s, [x, y], i) => { const [x2, y2] = pts[(i + 1) % pts.length]; return s + x * y2 - x2 * y }, 0)) / 2
      if (area < 110 || area > 400) continue
      const c = pts.reduce(([sx, sy], [x, y]) => [sx + x / pts.length, sy + y / pts.length], [0, 0])
      const s = nearest(c)
      if (!s || s.d < 14 || s.d > 40 || s.name?.toLowerCase() !== h.tags['addr:street'].toLowerCase()) continue
      const u = [(s.x - c[0]) / s.d, (s.y - c[1]) / s.d], v = [-u[1], u[0]]
      const front = Math.max(...pts.map(([x, y]) => (x - c[0]) * u[0] + (y - c[1]) * u[1]))
      const half = Math.max(...pts.map(([x, y]) => Math.abs((x - c[0]) * v[0] + (y - c[1]) * v[1])))
      const a = front + 1.5, b = s.d - 5.5, w = Math.min(half + 2, 12)
      if (b - a < 6) continue
      const at = (d, side) => [c[0] + u[0] * d + v[0] * w * side, c[1] + u[1] * d + v[1] * w * side]
      const sqFt = Math.round((b - a) * 2 * w * 10.7639 / 50) * 50
      if (sqFt < 1200) continue
      const mid = ll(at((a + b) / 2, 0)), t = h.tags
      found.push({ street: `${t['addr:housenumber']} ${t['addr:street']}`, town: t['addr:city'] ?? city.town, zip: t['addr:postcode']?.slice(0, 5) ?? city.zip,
        lat: mid[1], lng: mid[0], sqFt, coords: [at(a, -1), at(a, 1), at(b, 1), at(b, -1)].map(ll) })
    }
    return found
  }

  // Widen the search when a city runs short.
  let candidates = [], houses = []
  for (const radius of [1500, 3500]) {
    houses = await overpass(`way["building"~"^(house|detached|residential|semidetached_house)$"]["addr:housenumber"]["addr:street"](around:${radius},${lat0},${lng0});out geom;`)
    const roads = await overpass(`way["highway"="residential"]["name"](around:${radius + 200},${lat0},${lng0});out geom;`)
    candidates = usable(houses, roads)
    if (candidates.length >= wanted.length * 4) break
  }
  // Spread picks across the candidates so neighbours don't share a block.
  const step = Math.max(1, Math.floor(candidates.length / wanted.length))
  wanted.forEach((spec, i) => { const home = candidates[i * step]; if (home) out[spec.n] = home })
  console.log(`${key}: ${houses.length} houses, ${candidates.length} usable, ${wanted.length} needed`)
  await new Promise(r => setTimeout(r, 2000))
}
const missing = unique.filter(s => !out[s.n]).map(s => s.n)
if (missing.length) console.warn('No house for', missing.join(', '))
writeFileSync(new URL('./demo-properties.json', import.meta.url), JSON.stringify(out, null, 1) + '\n')
console.log(`Wrote ${Object.keys(out).length} properties`)
