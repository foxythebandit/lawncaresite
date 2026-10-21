/** A tab keeps the same ID through retries/reloads until the user explicitly starts over. */
export function submissionId(form: string): string {
  const key = `qg_submission_${form}`
  const existing = sessionStorage.getItem(key)
  if (existing) return existing
  const id = crypto.randomUUID()
  sessionStorage.setItem(key, id)
  return id
}
