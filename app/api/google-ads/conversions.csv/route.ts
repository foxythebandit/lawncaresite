import { GET as feed } from '../conversions/route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Same feed under a .csv path: Google Ads HTTPS uploads only accept URLs ending in .csv or .tsv. */
export const GET = feed
