import { useState } from 'react'
import { apiRequest } from './services/api'
import Dashboard from './pages/Dashboard'
import './App.css'

function App() {
  const [organizationId, setOrganizationId] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [user, setUser] = useState(() => {
    const savedUser = sessionStorage.getItem('fielddesk_user')

    try {
      return savedUser ? JSON.parse(savedUser) : null
    } catch {
      sessionStorage.removeItem('fielddesk_user')
      sessionStorage.removeItem('fielddesk_token')
      return null
    }
  })

  async function handleLogin(event) {
    event.preventDefault()
    setError('')
    setLoading(true)

    try {
      const data = await apiRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ organizationId, email, password }),
      })

      sessionStorage.setItem('fielddesk_token', data.token)
      sessionStorage.setItem('fielddesk_user', JSON.stringify(data.user))
      setUser(data.user)
      setPassword('')
    } catch (err) {
      setError(err.message || 'Unable to log in.')
    } finally {
      setLoading(false)
    }
  }

  async function handleLogout() {
    sessionStorage.removeItem('fielddesk_token')
    sessionStorage.removeItem('fielddesk_user')
    setUser(null)
    setOrganizationId('')
    setEmail('')
    setPassword('')
    setError('')
  }

  if (user) {
    return <Dashboard user={user} onLogout={handleLogout} />
  }

  return (
    <main className="app-shell">
      <section className="login-card">
        <div className="brand-mark">F</div>
        <p className="eyebrow">FIELD SERVICE MANAGEMENT</p>
        <h1>Welcome back</h1>
        <p className="subtitle">Sign in to manage your team's work orders.</p>

        <form onSubmit={handleLogin}>
          <label htmlFor="organizationId">Organization ID</label>
          <input
            id="organizationId"
            value={organizationId}
            onChange={(event) => setOrganizationId(event.target.value.trim())}
            placeholder="Enter your organization UUID"
            required
          />

          <label htmlFor="email">Email address</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@company.com"
            required
          />

          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter your password"
            required
          />

          {error && <p className="error-message" role="alert">{error}</p>}

          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <p className="login-footer">Secure access to your organization's workspace.</p>
      </section>
    </main>
  )
}

export default App
