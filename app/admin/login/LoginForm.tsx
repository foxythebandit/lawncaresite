'use client'

import Image from 'next/image'
import { useActionState } from 'react'
import { login } from '../actions'

export default function AdminLogin({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, null)

  return (
    <div className="admin-login-wrap">
      <div className="admin-login-card">
        <div className="admin-login-logo">
          <Image src="/quietgreen-logo-full.svg" alt="QuietGreen" width={160} height={37} priority />
        </div>
        <h1 className="admin-login-title">Staff sign in</h1>
        <p className="admin-login-sub">Leads, jobs, and customers in one place.</p>
        <form action={action} className="admin-login-form">
          <input type="hidden" name="next" value={next} />
          <label>Email
            <input type="email" name="email" placeholder="you@quietgreen.co" autoComplete="username" className="admin-login-input" required />
          </label>
          <label>Password
            <input
              type="password"
              name="password"
              className="admin-login-input"
              autoComplete="current-password"
              required
            />
          </label>
          {state?.error && <p className="admin-login-error" role="alert">{state.error}</p>}
          <button type="submit" className="admin-login-btn" disabled={pending}>
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
