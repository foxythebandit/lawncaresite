'use server'
import { verifiedLead } from '@/lib/intake'
import { websitePrice } from '@/lib/website-intake'
import { saveWebsiteQuote } from './website-quote'

/**
 * The customer changed how often after unlocking their price (PLAN.md 3.3, S10). Only the signed
 * lead token from the unlock can update that lead. The amounts come from the browser and are only
 * bounds-checked, so they record what the customer saw, never what we charge.
 */
export async function updateWebsitePrice(token: string, price: { price_per_visit: number; first_visit_price: number; frequency: string }) {
  const leadId = verifiedLead(token)
  const fields = websitePrice(price)
  if (!leadId || !fields) return { success: false }
  await saveWebsiteQuote(leadId, fields)
  return { success: true }
}
