/** Display US phone numbers consistently without changing stored/dialed values. */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return ''
  const digits = phone.replace(/\D/g, '')
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  if (national.length !== 10 || /[a-z]/i.test(phone) || (phone.trim().startsWith('+') && !phone.trim().startsWith('+1'))) return phone
  return `${national.slice(0, 3)}-${national.slice(3, 6)}-${national.slice(6)}`
}
