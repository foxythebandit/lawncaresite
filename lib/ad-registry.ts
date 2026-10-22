export type MetaCreative = { creative_id: string; creative_type: 'ai' | 'real' }

/** Server callers supply META_AD_CREATIVES; a known ad ID is the only lookup key. */
export function enrichMetaCreative(attribution: Record<string, unknown>, registryJSON?: string): Record<string, unknown> {
  const adId = attribution.meta_ad_id
  if (typeof adId !== 'string' || !/^\d{1,30}$/.test(adId) || !registryJSON) return attribution
  let registry: unknown
  try { registry = JSON.parse(registryJSON) } catch { return attribution }
  if (!registry || typeof registry !== 'object' || Array.isArray(registry) || !Object.hasOwn(registry, adId)) return attribution
  const entry = (registry as Record<string, unknown>)[adId]
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return attribution
  const creative = entry as Record<string, unknown>
  if (typeof creative.creative_id !== 'string' || !creative.creative_id.trim()
    || creative.creative_id.length > 150 || /[\x00-\x1f\x7f]/.test(creative.creative_id)
    || (creative.creative_type !== 'ai' && creative.creative_type !== 'real')) return attribution
  // Explicit staff configuration is authoritative over visitor-supplied labels.
  return { ...attribution, creative_id: creative.creative_id.trim(), creative_type: creative.creative_type }
}
