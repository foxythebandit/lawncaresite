// Places an actual phone call for new leads — rings like any incoming call
// (persists on the lock screen, no 30s gaps like a push notification) until
// answered or it goes to voicemail. Needs TWILIO_ACCOUNT_SID,
// TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER (the Twilio number) and
// TWILIO_OWNER_PHONE (the cell to ring) — until those are set, callLead
// silently no-ops so leads keep working without it.

function twiml(message: string): string {
  // <Say> reads the message aloud once the call is answered; the ringing
  // itself (before answer) is normal OS call-ringing, which is the whole
  // point — a push notification can't replicate that.
  const escaped = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<Response><Say voice="Polly.Matthew">${escaped}</Say><Pause length="1"/><Say voice="Polly.Matthew">${escaped}</Say></Response>`
}

export async function callLead(message: string): Promise<void> {
  const sid   = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from  = process.env.TWILIO_FROM_NUMBER
  const to    = process.env.TWILIO_OWNER_PHONE
  if (!sid || !token || !from || !to) return

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
      },
      body: new URLSearchParams({ To: to, From: from, Twiml: twiml(message) }),
    })
    if (!res.ok) console.error('Twilio call error:', await res.text())
  } catch (err) {
    console.error('Twilio call error:', err)
  }
}
