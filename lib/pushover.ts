// Phone alert for new leads/bookings. Needs PUSHOVER_TOKEN + PUSHOVER_USER
// set (Vercel env vars + .env.local) — until then, pingPhone silently no-ops
// so leads/bookings keep working without it.

const MESSAGES_URL = 'https://api.pushover.net/1/messages.json'
const cancelUrl = (receipt: string) => `https://api.pushover.net/1/receipts/${receipt}/cancel.json`

// 10pm–7am Central (Austin): emergency priority would ring through Do Not
// Disturb/Focus at that hour, so drop to a normal, silent-friendly alert.
function isQuietHours(): boolean {
  const hour = Number(
    new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false })
  )
  return hour >= 22 || hour < 7
}

/**
 * Sends a phone alert. Emergency priority (repeats every 60s for 15min
 * until acknowledged) outside quiet hours; normal priority during them or
 * for calm/informational pings. Returns a receipt (only emergency pushes
 * get one) so the alarm can be cancelled later via cancelPhonePing.
 */
export async function pingPhone(opts: {
  title: string
  message: string
  phone?: string | null
  urgent?: boolean // default true — set false for calm/informational pings (e.g. "booked")
}): Promise<string | null> {
  const token = process.env.PUSHOVER_TOKEN
  const user  = process.env.PUSHOVER_USER
  if (!token || !user) return null

  const urgent = (opts.urgent ?? true) && !isQuietHours()
  const body: Record<string, unknown> = {
    token, user,
    title: opts.title,
    message: opts.message,
    priority: urgent ? 2 : 0,
  }
  if (urgent) { body.retry = 60; body.expire = 900 }
  if (opts.phone) { body.url = `tel:${opts.phone}`; body.url_title = 'Call' }

  try {
    const res  = await fetch(MESSAGES_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => null)
    return json?.receipt ?? null
  } catch (err) {
    console.error('Pushover send error:', err)
    return null
  }
}

export async function cancelPhonePing(receipt: string | null | undefined) {
  if (!receipt) return
  const token = process.env.PUSHOVER_TOKEN
  if (!token) return
  try {
    await fetch(cancelUrl(receipt), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
  } catch (err) {
    console.error('Pushover cancel error:', err)
  }
}
