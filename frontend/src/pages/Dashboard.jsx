import { useCallback, useEffect, useState } from 'react'
import {
  getWorkOrders,
  createWorkOrder,
  getTechnicians,
  assignWorkOrder,
} from '../services/workOrders'
import { consumeRealtimeEvents } from '../services/realtime'
import WorkOrderDetails from './WorkOrderDetails'

const STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT']

function Dashboard({ user, onLogout }) {
  const [orders, setOrders] = useState([])
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 0 })
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [priority, setPriority] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [form, setForm] = useState({
    title: '',
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    serviceAddress: '',
    description: '',
    priority: 'MEDIUM',
  })
  const [technicians, setTechnicians] = useState([])
  const [techniciansLoading, setTechniciansLoading] = useState(false)
  const [assigningOrderId, setAssigningOrderId] = useState(null)
  const [assignmentError, setAssignmentError] = useState('')
  const [assignmentSuccess, setAssignmentSuccess] = useState('')
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [realtimeStatus, setRealtimeStatus] = useState('connecting')
  const canManageWorkOrders = user.role === 'OWNER' || user.role === 'DISPATCHER'

  const loadOrders = useCallback(async (page = 1) => {
    setLoading(true)
    setError('')

    try {
      const result = await getWorkOrders({
        page,
        limit: 10,
        search,
        status,
        priority,
        sortBy: 'created_at',
        sortOrder: 'desc',
      })

      setOrders(result.data || [])
      setPagination(result.pagination || { page: 1, total: 0, totalPages: 0 })
    } catch (err) {
      setError(err.message || 'Could not load work orders.')
    } finally {
      setLoading(false)
    }
  }, [search, status, priority])

  useEffect(() => {
    const timer = setTimeout(() => loadOrders(1), 250)
    return () => clearTimeout(timer)
  }, [loadOrders])

  useEffect(() => {
    if (!canManageWorkOrders) return undefined

    async function loadTechnicians() {
      setTechniciansLoading(true)
      try {
        const result = await getTechnicians()
        setTechnicians(result.data || [])
      } catch (err) {
        setAssignmentError(err.message || 'Could not load technicians.')
      } finally {
        setTechniciansLoading(false)
      }
    }

    loadTechnicians()
    return undefined
  }, [canManageWorkOrders])

  useEffect(() => {
    const controller = new AbortController()
    let stopped = false
    let retryDelay = 1000

    async function connectToRealtime() {
      while (!stopped) {
        setRealtimeStatus('connecting')
        try {
          await consumeRealtimeEvents({
            signal: controller.signal,
            onEvent: (type) => {
              retryDelay = 1000
              setRealtimeStatus('connected')
              if (type.startsWith('work_order.') || type.startsWith('attachment.') ||
                  type.startsWith('progress_event.') || type.startsWith('notification.')) {
                void loadOrders(pagination.page)
              }
            },
          })
          if (!stopped) throw new Error('Real-time connection closed')
        } catch {
          if (stopped) return
          setRealtimeStatus('disconnected')
          await new Promise((resolve) => {
            const timeout = setTimeout(resolve, retryDelay)
            controller.signal.addEventListener('abort', () => {
              clearTimeout(timeout)
              resolve()
            }, { once: true })
          })
          retryDelay = Math.min(retryDelay * 2, 15000)
        }
      }
    }

    void connectToRealtime()
    return () => {
      stopped = true
      controller.abort()
    }
  }, [loadOrders, pagination.page])

  function updateField(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }))
  }

  async function handleCreate(event) {
    event.preventDefault()
    setSaving(true)
    setFormError('')

    const payload = {
      title: form.title,
      customerName: form.customerName,
      serviceAddress: form.serviceAddress,
      priority: form.priority,
    }

    if (form.customerEmail) payload.customerEmail = form.customerEmail
    if (form.customerPhone) payload.customerPhone = form.customerPhone
    if (form.description) payload.description = form.description

    try {
      await createWorkOrder(payload)
      setShowForm(false)
      setForm({
        title: '',
        customerName: '',
        customerEmail: '',
        customerPhone: '',
        serviceAddress: '',
        description: '',
        priority: 'MEDIUM',
      })
      await loadOrders(1)
    } catch (err) {
      setFormError(err.message || 'Could not create the work order.')
    } finally {
      setSaving(false)
    }
  }

  const countStatus = (value) => orders.filter((order) => order.status === value).length

  async function handleAssign(orderId, technicianId) {
    if (!technicianId) return

    setAssignmentError('')
    setAssignmentSuccess('')
    setAssigningOrderId(orderId)

    try {
      await assignWorkOrder(orderId, technicianId)
      setAssignmentSuccess('Technician assigned successfully.')
      await loadOrders(pagination.page)
    } catch (err) {
      setAssignmentError(
        err.message || 'Could not assign technician. Check the schedule for conflicts.',
      )
    } finally {
      setAssigningOrderId(null)
    }
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div className="header-brand">
          <div className="brand-mark">F</div>
          <div>
            <strong>FieldDesk</strong>
            <span>Service operations</span>
          </div>
        </div>

        <div className="header-user">
          <div>
            <strong>{user.name}</strong>
            <span>{user.role}</span>
          </div>
          <button className="secondary-button" onClick={onLogout}>Log out</button>
        </div>
      </header>

      <section className="dashboard-content">
        <div className="page-heading">
          <div>
            <p className="eyebrow">WORKSPACE OVERVIEW</p>
            <h1>{user.role === 'TECHNICIAN' ? 'My work orders' : 'Work orders'}</h1>
            <p className="subtitle">
              {user.role === 'TECHNICIAN'
                ? 'View your assigned work and submit progress updates.'
                : 'Manage customer requests and service operations.'}
            </p>
          </div>
          {canManageWorkOrders && (
            <button className="primary-button create-button" onClick={() => setShowForm(!showForm)}>
              {showForm ? 'Close form' : '+ New work order'}
            </button>
          )}
        </div>
        <p className="realtime-status" role="status">
          {realtimeStatus === 'connected' ? 'Live updates connected' :
            realtimeStatus === 'disconnected' ? 'Live updates unavailable; reconnecting…' :
              'Connecting to live updates…'}
        </p>

        <div className="summary-grid">
          <article className="summary-card">
            <span>Total matching orders</span>
            <strong>{pagination.total}</strong>
          </article>
          <article className="summary-card">
            <span>Open on this page</span>
            <strong>{countStatus('OPEN')}</strong>
          </article>
          <article className="summary-card">
            <span>In progress on this page</span>
            <strong>{countStatus('IN_PROGRESS')}</strong>
          </article>
          <article className="summary-card">
            <span>Completed on this page</span>
            <strong>{countStatus('COMPLETED')}</strong>
          </article>
        </div>

        {showForm && (
          <section className="panel form-panel">
            <h2>Create work order</h2>
            <p className="subtitle">Enter the customer and service details below.</p>

            <form className="work-order-form" onSubmit={handleCreate}>
              <label>
                Work order title *
                <input name="title" value={form.title} onChange={updateField} minLength={3} maxLength={200} required />
              </label>
              <label>
                Customer name *
                <input name="customerName" value={form.customerName} onChange={updateField} minLength={2} maxLength={150} required />
              </label>
              <label>
                Customer email
                <input name="customerEmail" type="email" value={form.customerEmail} onChange={updateField} />
              </label>
              <label>
                Customer phone
                <input name="customerPhone" value={form.customerPhone} onChange={updateField} maxLength={30} />
              </label>
              <label className="full-field">
                Service address *
                <input name="serviceAddress" value={form.serviceAddress} onChange={updateField} minLength={5} maxLength={1000} required />
              </label>
              <label>
                Priority
                <select name="priority" value={form.priority} onChange={updateField}>
                  {PRIORITIES.map((item) => <option key={item}>{item}</option>)}
                </select>
              </label>
              <label className="full-field">
                Description
                <textarea name="description" value={form.description} onChange={updateField} maxLength={5000} rows={3} />
              </label>

              {formError && <p className="error-message full-field" role="alert">{formError}</p>}
              <div className="form-actions full-field">
                <button type="button" className="secondary-button" onClick={() => setShowForm(false)}>Cancel</button>
                <button className="primary-button" type="submit" disabled={saving}>
                  {saving ? 'Creating...' : 'Create work order'}
                </button>
              </div>
            </form>
          </section>
        )}

        {selectedOrder && (
          <WorkOrderDetails
            order={selectedOrder}
            user={user}
            technicians={technicians}
            onClose={() => setSelectedOrder(null)}
            onUpdated={(updated) => {
              setSelectedOrder(updated)
              void loadOrders(pagination.page)
            }}
            onDeleted={() => {
              setSelectedOrder(null)
              void loadOrders(pagination.page)
            }}
          />
        )}

        <section className="panel">
          <div className="list-heading">
            <div>
              <h2>{user.role === 'TECHNICIAN' ? 'Assigned to me' : 'All work orders'}</h2>
              <p className="subtitle">
                {user.role === 'TECHNICIAN'
                  ? 'Only work orders assigned to your account are shown.'
                  : "Search and filter your organization's orders."}
              </p>
            </div>
          </div>

          <div className="filters">
            <input
              aria-label="Search work orders"
              placeholder="Search title or customer..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">All statuses</option>
              {STATUSES.map((item) => <option key={item}>{item}</option>)}
            </select>
            <select aria-label="Filter by priority" value={priority} onChange={(event) => setPriority(event.target.value)}>
              <option value="">All priorities</option>
              {PRIORITIES.map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>

          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button className="secondary-button" onClick={() => loadOrders(pagination.page)}>Retry</button>
            </div>
          )}

          {assignmentError && <p role="alert">{assignmentError}</p>}
          {assignmentSuccess && <p role="status">{assignmentSuccess}</p>}

          {loading ? (
            <p className="state-message">Loading work orders...</p>
          ) : orders.length === 0 ? (
            <div className="empty-state">
              <h3>No work orders found</h3>
              <p>Try another filter or create your first work order.</p>
            </div>
          ) : (
            <>
              <div className="table-scroll">
                <table className="orders-table">
                  <thead>
                    <tr>
                      <th>Work order</th>
                      <th>Customer</th>
                      <th>Priority</th>
                      <th>Status</th>
                      <th>Technician assignment</th>
                      <th>Scheduled</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => (
                      <tr key={order.id}>
                        <td>
                          <strong>{order.title}</strong>
                          <span className="cell-subtitle">{order.service_address}</span>
                        </td>
                        <td>{order.customer_name}</td>
                        <td><span className={`priority priority-${order.priority.toLowerCase()}`}>{order.priority}</span></td>
                        <td><span className={`status status-${order.status.toLowerCase()}`}>{order.status.replaceAll('_', ' ')}</span></td>
                        <td>
                          {canManageWorkOrders ? (
                            <>
                              {techniciansLoading ? <small>Loading technicians...</small> : (
                                <select
                                  aria-label={`Assign technician to ${order.title}`}
                                  value={order.assigned_technician_id || ''}
                                  disabled={assigningOrderId === order.id || technicians.length === 0}
                                  onChange={(event) => handleAssign(order.id, event.target.value)}
                                >
                                  <option value="">Select technician</option>
                                  {technicians.map((technician) => (
                                    <option key={technician.id} value={technician.id}>
                                      {technician.name} ({technician.email})
                                    </option>
                                  ))}
                                </select>
                              )}
                            </>
                          ) : (order.assigned_technician_id ? 'Assigned' : 'Unassigned')}
                          {assigningOrderId === order.id && <small>Assigning...</small>}
                        </td>
                        <td>{order.scheduled_start ? new Date(order.scheduled_start).toLocaleString() : 'Not scheduled'}</td>
                        <td>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => setSelectedOrder(order)}
                          >
                            View details
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="pagination">
                <span>
                  Page {pagination.page} of {Math.max(pagination.totalPages, 1)} · {pagination.total} total
                </span>
                <div>
                  <button className="secondary-button" disabled={pagination.page <= 1} onClick={() => loadOrders(pagination.page - 1)}>Previous</button>
                  <button className="secondary-button" disabled={pagination.page >= pagination.totalPages} onClick={() => loadOrders(pagination.page + 1)}>Next</button>
                </div>
              </div>
            </>
          )}
        </section>
      </section>
    </main>
  )
}

export default Dashboard
