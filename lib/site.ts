// Canonical site facts shared by metadata and structured data.
export const SITE_URL = 'https://quietgreen.co'
export const BUSINESS_ID = `${SITE_URL}/#business`
export const GOOGLE_MAPS_URL = 'https://www.google.com/maps?cid=10749444056015936389'

// JSON.stringify doesn't escape `<`, so a stray "</script>" in content could break out of the tag.
export function jsonLd(data: object) {
  return { __html: JSON.stringify(data).replace(/</g, '\\u003c') }
}
