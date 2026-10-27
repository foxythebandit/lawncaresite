import type { PropertyConfirmation } from './property-location'

export interface QuoteDraft {
  contactAddressAtReview?: string | null
  propertyConfirmation?: PropertyConfirmation | null
  address: string
  sections: { id: string; name: string; sqFt: number; coords: [number, number][] | null }[]
  unfinishedPoints?: [number, number][]
  unfinishedTarget?: 'fertilization' | 'mulch' | 'yardClearout' | null
  jobLatLng: { lat: number; lng: number } | null
  freq: 'onetime' | 'monthly' | 'biweekly' | 'weekly'
  lastMow: string
  fertAreaChoice: 'same' | 'custom' | null
  fertCustomSqFt: number | null
  fertIncluded: boolean
  mulchAreaChoice: 'same' | 'custom' | null
  mulchCustomSqFt: number | null
  mulchDepthIn: number
  mulchIncluded: boolean
  maintenanceInterested: boolean
  yardAreaChoice: 'same' | 'custom' | null
  yardCustomSqFt: number | null
  yardSeverity: 'light' | 'moderate' | 'heavy'
  yardHazards: string[]
  yardIncluded: boolean
  addonInterest?: Record<string, unknown> | null
  overgrowthFee?: number
  calculatedPrice: number
  calculatedFirstVisit: number
  overridePrice: number | null
  includeMowing?: boolean
  manualLines?: { id: string; service: string; amountCents: number }[]
  discountCents?: number
  totalCents?: number
  notes: string
}
export interface StaffQuote {
  services?: string[]
  frequency?: string | null
  id: string
  address: string | null
  sq_ft: number | null
  draft: QuoteDraft | null
  updated_at: string
  quote_status: 'draft' | 'accepted' | 'declined' | 'canceled'
  lookupAddress?: string
  addressNeedsReview?: boolean
  onSaved?: (updatedAt: string, reviewed: boolean, draft: QuoteDraft) => void
}

export function quoteTotalCents(draft: QuoteDraft) {
  const mowingCents = draft.includeMowing === false ? 0 : Math.round((draft.overridePrice ?? draft.calculatedPrice) * 100)
  const lines = draft.manualLines ?? []
  const discountCents = draft.discountCents ?? 0
  return mowingCents + lines.reduce((sum, line) => sum + line.amountCents, 0) - discountCents
}
