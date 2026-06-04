'use client'

import { useActionState } from 'react'
import { login } from '../actions'

export default function AdminLogin() {
  const [state, action, pending] = useActionState(login, null)

  return (
    <div className="admin-login-wrap">
      <div className="admin-login-card">
        <div className="admin-login-logo">
          <span className="logo-dot" style={{ background: 'var(--green-bright)', width: 10, height: 10, borderRadius: '50%', display: 'inline-block' }} />
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 20, color: 'var(--green-deep)' }}>QuietGreen</span>
        </div>
        <h1 className="admin-login-title">Admin</h1>
        <form action={action} className="admin-login-form">
          <input
            type="password"
            name="password"
            placeholder="Password"
            className="admin-login-input"
            autoFocus
            required
          />
          {state?.error && <p className="admin-login-error">{state.error}</p>}
          <button type="submit" className="admin-login-btn" disabled={pending}>
            {pending ? 'Signing in…' : 'Sign in →'}
          </button>
        </form>
      </div>
    </div>
  )
}
