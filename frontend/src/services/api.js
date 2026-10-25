const API_BASE_URL =
  import.meta.env.VITE_API_URL || 'http://localhost:5000/api'

export async function apiRequest(path, options = {}) {
  const token = sessionStorage.getItem('fielddesk_token')

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })

  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    if (response.status === 401) {
      sessionStorage.removeItem('fielddesk_token')
      sessionStorage.removeItem('fielddesk_user')
    }

    throw new Error(data.message || 'Something went wrong. Please try again.')
  }

  return data
}
