export interface QuoteDraft {
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
  notes: string
}
export interface StaffQuote {
  services?: string[]
  frequency?: string | null
  id: string
  address: string | null
  sq_ft: number | null
  draft: QuoteDraft | null
}
