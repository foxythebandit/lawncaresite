/** Preserve a separately submitted US postcode without guessing missing location details. */
export function fullAddressWithPostcode(address: string, postcode: unknown): string {
  const zip = typeof postcode === 'string' ? postcode.trim() : ''
  if (!address.trim() || !/^\d{5}(?:-\d{4})?$/.test(zip)
    || /\b\d{5}(?:-\d{4})?\s*$/.test(address)) return address
  return `${address.trim()}, ${zip}`
}

/** Historical postcode belongs only to the unchanged submitted address. */
export function addressForLookup(currentAddress: string, submittedAddress: unknown, postcode: unknown): string {
  let submitted = typeof submittedAddress === 'string' ? submittedAddress.trim() : ''
  if (submittedAddress && typeof submittedAddress === 'object' && !Array.isArray(submittedAddress)) {
    const parts = submittedAddress as Record<string, unknown>
    if (typeof parts.street === 'string' && parts.street.trim()
      && typeof parts.city === 'string' && parts.city.trim()) {
      submitted = [parts.street, typeof parts.unit === 'string' ? parts.unit : '', parts.city]
        .map(part => part.trim()).filter(Boolean).join(', ')
    }
  }
  if (!submitted) return currentAddress
  const full = fullAddressWithPostcode(submitted, postcode)
  return currentAddress === submitted || currentAddress === full ? full : currentAddress
}
