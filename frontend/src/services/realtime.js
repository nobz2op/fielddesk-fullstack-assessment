const API_BASE_URL =
  import.meta.env.VITE_API_URL || 'http://localhost:5000/api'

export async function consumeRealtimeEvents({ signal, onEvent }) {
  const token = sessionStorage.getItem('fielddesk_token')
  if (!token) throw new Error('Authentication required for live updates.')

  const response = await fetch(`${API_BASE_URL}/realtime/events`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  })
  if (!response.ok) {
    throw new Error(`Live updates unavailable (${response.status}).`)
  }
  if (!response.body) throw new Error('Live update stream is unavailable.')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (!signal.aborted) {
    const { value, done } = await reader.read()
    if (done) return
    buffer += decoder.decode(value, { stream: true })

    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const type = frame.match(/^event:\s*(.+)$/m)?.[1]
      const data = frame.match(/^data:\s*(.+)$/m)?.[1]
      if (type && data && type !== 'connected' && type !== 'unavailable') {
        onEvent(type, JSON.parse(data))
      }
      boundary = buffer.indexOf('\n\n')
    }
  }
}
