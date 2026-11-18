import { timingSafeEqual } from 'node:crypto'

/** HTTP Basic credentials Google Ads uses for the scheduled "conversions from clicks" upload. */
export function feedAuthorized(header: string | null, rawUser = process.env.GOOGLE_ADS_FEED_USER, rawPassword = process.env.GOOGLE_ADS_FEED_PASSWORD) {
  // Values pasted into the Vercel dashboard can pick up a trailing newline or space.
  const user = rawUser?.trim(), password = rawPassword?.trim()
  if (!user || !password || password.length < 16) return false
  const actual = Buffer.from(header ?? ''), expected = Buffer.from(`Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
