/** Only these internal paths may survive a staff login. No query strings/PII. */
export function staffReturnTo(value: unknown): string {
  return typeof value === 'string' && /^\/admin(?:\/[a-zA-Z0-9_-]+)*$/.test(value) && !value.startsWith('/admin/login')
    ? value : '/admin/leads'
}

export function isStaff(user: { email?: string; email_confirmed_at?: string; app_metadata?: Record<string, unknown> } | null, allowlist = process.env.STAFF_EMAILS ?? ''): boolean {
  const emails = allowlist.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  return !!user?.email && !!user.email_confirmed_at && user.app_metadata?.role === 'staff' && emails.includes(user.email.toLowerCase())
}
