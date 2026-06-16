'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function PortalLogin() {
  const [email, setEmail]   = useState('')
  const [sent, setSent]     = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/portal/auth/callback`,
        shouldCreateUser: true,
      },
    })

    setLoading(false)
    if (error) {
      setError('Something went wrong. Please try again.')
    } else {
      setSent(true)
    }
  }

  if (sent) {
    return (
      <div className="portal-login-wrap">
        <div className="portal-login-card">
          <div className="portal-login-icon">✉</div>
          <h1 className="portal-login-title">Check your email</h1>
          <p className="portal-login-sub">
            We sent a login link to <strong>{email}</strong>. Click it to access your account — no password needed.
          </p>
          <button className="portal-login-resend" onClick={() => setSent(false)}>
            Use a different email
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="portal-login-wrap">
      <div className="portal-login-card">
        <h1 className="portal-login-title">Sign in to your account</h1>
        <p className="portal-login-sub">Enter the email you used when booking. We'll send you a link — no password needed.</p>
        <form onSubmit={handleSubmit} className="portal-login-form">
          <input
            type="email"
            required
            autoFocus
            placeholder="your@email.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="portal-login-input"
          />
          {error && <p className="portal-login-error">{error}</p>}
          <button type="submit" className="portal-login-btn" disabled={loading}>
            {loading ? 'Sending…' : 'Send login link'}
          </button>
        </form>
      </div>
    </div>
  )
}
