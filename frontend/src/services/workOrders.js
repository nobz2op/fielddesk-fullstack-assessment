import { apiRequest } from './api'

export function getWorkOrders(filters = {}) {
  const params = new URLSearchParams()

  Object.entries(filters).forEach(([key, value]) => {
    if (value !== '' && value !== undefined && value !== null) {
      params.set(key, String(value))
    }
  })

  const query = params.toString()

  return apiRequest(`/work-orders${query ? `?${query}` : ''}`)
}

export function createWorkOrder(workOrder) {
  return apiRequest('/work-orders', {
    method: 'POST',
    body: JSON.stringify(workOrder),
  })
}

export function updateWorkOrder(id, updates) {
  return apiRequest(`/work-orders/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  })
}

export function getWorkOrderActivities(id) {
  return apiRequest(`/work-orders/${id}/activities`)
}

export function getWorkOrder(id) {
  return apiRequest(`/work-orders/${id}`)
}

export function getTechnicians() {
  return apiRequest('/organizations/technicians')
}

export function assignWorkOrder(id, technicianId) {
  return apiRequest(`/work-orders/${id}/assign`, {
    method: 'PATCH',
    body: JSON.stringify({ technicianId }),
  })
}

export function deleteWorkOrder(id) {
    return apiRequest(`/work-orders/${id}`, { method: 'DELETE' })
}

export function createProgressEvent(event) {
    return apiRequest('/progress-events', {
      method: 'POST',
      body: JSON.stringify(event),
    })
}
