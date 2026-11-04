import { useEffect, useState } from 'react'
import { sendCode, register, login } from '../auth/localAuth'

// Shown as a popup. `onClose` lets the visitor dismiss it and keep using the editor as a guest.
export default function Login({ onAuth, onClose }) {
  const [mode, setMode] = useState('login') // 'login' | 'register'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [demoCode, setDemoCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Esc closes the popup
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function handleSendCode() {
    setError('')
    try {
      setDemoCode(sendCode(email))
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const user =
        mode === 'login' ? await login(email, password, code) : await register(email, password, code)
      onAuth(user)
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  function switchMode(next) {
    setMode(next)
    setError('')
    setDemoCode('')
    setCode('')
  }

  return (
    <div
      className="auth-page"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.() // click on the dark background closes it
      }}
    >
      <form className="auth-card" onSubmit={handleSubmit}>
        {onClose && (
          <button type="button" className="auth-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        )}

        <div className="brand">&lt;/&gt; CodeDesk</div>
        <p className="auth-sub">Log in to save your code online. You can also keep using the editor without an account.</p>

        <div className="auth-tabs">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')}>
            Log in
          </button>
          <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => switchMode('register')}>
            Register
          </button>
        </div>

        <label>
          Email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@college.edu" />
        </label>

        <label>
          Password
          <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" />
        </label>

        <label>
          Verification code
          <div className="code-row">
            <input type="text" inputMode="numeric" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit code" />
            <button type="button" className="btn-secondary" onClick={handleSendCode}>
              Send code
            </button>
          </div>
        </label>

        {demoCode && (
          <div className="auth-msg ok">
            Demo mode: no email service is connected yet, so your code is <strong>{demoCode}</strong>
          </div>
        )}
        {error && <div className="auth-msg error">{error}</div>}

        <button className="btn-primary" type="submit" disabled={busy}>
          {busy ? 'Please wait...' : mode === 'login' ? 'Log in' : 'Create account'}
        </button>

        {onClose && (
          <button type="button" className="auth-skip" onClick={onClose}>
            Continue without logging in
          </button>
        )}
      </form>
    </div>
  )
}
