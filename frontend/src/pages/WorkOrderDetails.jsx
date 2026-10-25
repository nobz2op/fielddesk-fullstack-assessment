import { useEffect, useState } from 'react'
import {
  assignWorkOrder,
  createProgressEvent,
  deleteWorkOrder,
  getWorkOrder,
  getWorkOrderActivities,
  updateWorkOrder,
} from '../services/workOrders'

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT']

const ACTIVITY_TITLES = {
  CREATED: 'Work order created',
  UPDATED: 'Work order updated',
  ASSIGNED: 'Technician assigned',
  STATUS_CHANGED: 'Status changed',
  ATTACHMENT_ADDED: 'Attachment added',
  NOTE_ADDED: 'Progress note added',
  LOCATION_UPDATED: 'Location updated',
  EVENT_SUBMITTED: 'Progress event recorded',
  DELETED: 'Work order archived',
}

const FIELD_LABELS = {
  customerEmail: 'Customer email',
  customerName: 'Customer name',
  customerPhone: 'Customer phone',
  scheduledEnd: 'Scheduled end',
  scheduledStart: 'Scheduled start',
  serviceAddress: 'Service address',
  status: 'Status',
  title: 'Title',
}

const SENSITIVE_FIELDS = new Set([
  'customerEmail',
  'customerPhone',
  'location',
])

const ENUM_FIELDS = new Set(['priority', 'status'])

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function formatFieldLabel(field) {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field]

  return String(field)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatEnumValue(value) {
  return value
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatActivityValue(value, field) {
  if (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    return 'Not set'
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return String(value)
  if (value instanceof Date) return formatActivityTimestamp(value)
  if (typeof value !== 'string') return 'Updated'

  if (
    ENUM_FIELDS.has(field) &&
    /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/.test(value)
  ) {
    return formatEnumValue(value)
  }

  if (/^scheduled(?:Start|End)$/i.test(field)) {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) return formatActivityTimestamp(date)
  }

  return value
}

function areActivityValuesEqual(before, after) {
  if (Object.is(before, after)) return true
  if (before instanceof Date && after instanceof Date) {
    return before.getTime() === after.getTime()
  }
  if (isRecord(before) && isRecord(after)) {
    const beforeKeys = Object.keys(before)
    const afterKeys = Object.keys(after)
    return beforeKeys.length === afterKeys.length &&
      beforeKeys.every((key) => Object.hasOwn(after, key) &&
        areActivityValuesEqual(before[key], after[key]))
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    return before.length === after.length &&
      before.every((value, index) => areActivityValuesEqual(value, after[index]))
  }
  return false
}

function formatActivityTimestamp(value) {
  if (value === null || value === undefined || value === '') return 'Date unavailable'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return 'Date unavailable'

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function getActivityTitle(action) {
  if (typeof action !== 'string' || !action.trim()) return 'Activity recorded'
  if (ACTIVITY_TITLES[action]) return ACTIVITY_TITLES[action]

  const readableAction = action
    .replace(/[._-]+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
  return `Activity recorded: ${readableAction}`
}

function getActivityDescriptions(activity) {
  const details = isRecord(activity?.details) ? activity.details : {}
  const changes = isRecord(details.changes) ? details.changes : null
  const descriptions = []

  if (changes) {
    for (const [field, change] of Object.entries(changes)) {
      if (!isRecord(change) || !('from' in change || 'to' in change)) continue

      const before = change.from
      const after = change.to
      if (areActivityValuesEqual(before, after)) continue

      const label = formatFieldLabel(field)
      if (SENSITIVE_FIELDS.has(field)) {
        descriptions.push(`${label} updated`)
      } else if (
        (before !== null && typeof before === 'object') ||
        (after !== null && typeof after === 'object')
      ) {
        descriptions.push(`${label} updated`)
      } else if (!('from' in change)) {
        descriptions.push(`${label} set to ${formatActivityValue(after, field)}`)
      } else if (!('to' in change)) {
        descriptions.push(`${label} cleared (was ${formatActivityValue(before, field)})`)
      } else {
        const beforeText = formatActivityValue(before, field)
        const afterText = formatActivityValue(after, field)
        if (beforeText !== afterText) {
          descriptions.push(`${label} changed from ${beforeText} to ${afterText}`)
        }
      }
    }
  }

  if (descriptions.length > 0) return descriptions

  switch (activity?.action) {
    case 'CREATED':
      return ['Work order created.']
    case 'ASSIGNED':
      return details.status
        ? [`Work order status: ${formatActivityValue(details.status, 'status')}`]
        : ['Technician assignment updated.']
    case 'STATUS_CHANGED':
      return details.status
        ? [`Status changed to ${formatActivityValue(details.status, 'status')}`]
        : ['Status change recorded.']
    case 'UPDATED':
      return ['Work order updated.']
    case 'DELETED':
      return ['Removed from active work; history retained.']
    case 'ATTACHMENT_ADDED':
      return ['An attachment was added.']
    case 'NOTE_ADDED':
      return ['A progress note was added.']
    case 'LOCATION_UPDATED':
      return ['Work location updated.']
    case 'EVENT_SUBMITTED': {
      const eventType = typeof details.eventType === 'string'
        ? details.eventType
        : ''
      if (eventType === 'status_changed' && details.status) {
        return [`Status changed to ${formatActivityValue(details.status, 'status')}`]
      }
      if (eventType === 'note_added') return ['A progress note was added.']
      if (eventType === 'location_updated') return ['Work location updated.']
      return ['A progress event was recorded.']
    }
    default:
      return ['No additional details available.']
  }
}

function getActivityActorName(activity) {
  const actorName = activity?.actor_name ??
    activity?.actorName ??
    (isRecord(activity?.actor) ? activity.actor.name : null)
  return typeof actorName === 'string' && actorName.trim()
    ? actorName.trim()
    : null
}

function toDateTimeInput(value) {
  if (!value) return ''
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function WorkOrderDetails({ order: initialOrder, user, technicians, onClose, onUpdated, onDeleted }) {
  const [order, setOrder] = useState(initialOrder)
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [form, setForm] = useState({})
  const [progressType, setProgressType] = useState('status_changed')
  const [progressStatus, setProgressStatus] = useState('IN_PROGRESS')
  const [progressNote, setProgressNote] = useState('')
  const [submittingProgress, setSubmittingProgress] = useState(false)

  const canManage = user.role === 'OWNER' || user.role === 'DISPATCHER'
  const isOwner = user.role === 'OWNER'
  const isTechnician = user.role === 'TECHNICIAN'

  async function refreshDetails() {
    const [workOrderResult, activityResult] = await Promise.all([
      getWorkOrder(initialOrder.id),
      getWorkOrderActivities(initialOrder.id),
    ])
    setOrder(workOrderResult.data)
    setActivities(activityResult.data || [])
    onUpdated(workOrderResult.data)
  }

  useEffect(() => {
    let active = true
    Promise.all([
      getWorkOrder(initialOrder.id),
      getWorkOrderActivities(initialOrder.id),
    ]).then(([workOrderResult, activityResult]) => {
      if (!active) return
      setOrder(workOrderResult.data)
      setActivities(activityResult.data || [])
    }).catch((err) => {
      if (active) setError(err.message || 'Could not load work-order details.')
    }).finally(() => {
      if (active) setLoading(false)
    })

    return () => { active = false }
  }, [initialOrder.id])

  function startEditing() {
    setForm({
      title: order.title || '',
      description: order.description || '',
      customerName: order.customer_name || '',
      customerEmail: order.customer_email || '',
      customerPhone: order.customer_phone || '',
      serviceAddress: order.service_address || '',
      priority: order.priority || 'MEDIUM',
      status: order.status || 'OPEN',
      scheduledStart: toDateTimeInput(order.scheduled_start),
      scheduledEnd: toDateTimeInput(order.scheduled_end),
    })
    setMessage('')
    setError('')
    setEditing(true)
  }

  function updateForm(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }))
  }

  async function saveChanges(event) {
    event.preventDefault()
    setError('')
    setMessage('')
    if (form.scheduledStart && form.scheduledEnd &&
        new Date(form.scheduledEnd) <= new Date(form.scheduledStart)) {
      setError('Scheduled end must be after scheduled start.')
      return
    }

    const updates = {
      title: form.title,
      description: form.description || null,
      customerName: form.customerName,
      customerEmail: form.customerEmail || null,
      customerPhone: form.customerPhone || null,
      serviceAddress: form.serviceAddress,
      priority: form.priority,
      status: form.status,
      scheduledStart: form.scheduledStart ? new Date(form.scheduledStart).toISOString() : null,
      scheduledEnd: form.scheduledEnd ? new Date(form.scheduledEnd).toISOString() : null,
    }

    setSaving(true)
    try {
      const result = await updateWorkOrder(order.id, updates)
      setOrder(result.data)
      setEditing(false)
      setMessage('Work order updated successfully.')
      onUpdated(result.data)
      const activityResult = await getWorkOrderActivities(order.id)
      setActivities(activityResult.data || [])
    } catch (err) {
      setError(err.message || 'Could not update the work order.')
    } finally {
      setSaving(false)
    }
  }

  async function handleAssignment(event) {
    const technicianId = event.target.value
    if (!technicianId) return
    setError('')
    setMessage('')
    setSaving(true)
    try {
      const result = await assignWorkOrder(order.id, technicianId)
      setOrder(result.data)
      setMessage('Technician assigned successfully.')
      onUpdated(result.data)
      const activityResult = await getWorkOrderActivities(order.id)
      setActivities(activityResult.data || [])
    } catch (err) {
      setError(err.message || 'Could not assign technician. Check the schedule for conflicts.')
    } finally {
      setSaving(false)
    }
  }

  async function submitProgress(event) {
    event.preventDefault()
    setError('')
    setMessage('')
    setSubmittingProgress(true)
    try {
      await createProgressEvent({
        eventId: crypto.randomUUID(),
        workOrderId: order.id,
        type: progressType,
        occurredAt: new Date().toISOString(),
        payload: progressType === 'status_changed'
          ? { status: progressStatus }
          : { note: progressNote.trim() },
      })
      setProgressNote('')
      setMessage('Progress update submitted.')
      await refreshDetails()
    } catch (err) {
      setError(err.message || 'Could not submit the progress update.')
    } finally {
      setSubmittingProgress(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Remove work order "${order.title}" from active work? Its audit history will be retained.`)) return
    setError('')
    setMessage('')
    setSaving(true)
    try {
      await deleteWorkOrder(order.id)
      onDeleted(order.id)
    } catch (err) {
      setError(err.message || 'Could not delete the work order.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="panel work-order-detail" aria-label={`Work order details: ${order.title}`}>
      <div className="detail-heading">
        <div>
          <p className="eyebrow">WORK ORDER DETAILS</p>
          <h2>{order.title}</h2>
          <p className="subtitle">Review service information, scheduling and activity.</p>
        </div>
        <button className="secondary-button" onClick={onClose}>Back to work orders</button>
      </div>

      {loading ? <p className="state-message">Loading work-order details...</p> : (
        <>
          {error && <p className="error-message" role="alert">{error}</p>}
          {message && <p className="success-message" role="status">{message}</p>}

          {editing ? (
            <form className="work-order-form detail-form" onSubmit={saveChanges}>
              <label>Title *
                <input name="title" value={form.title} onChange={updateForm} minLength={3} maxLength={200} required />
              </label>
              <label>Customer name *
                <input name="customerName" value={form.customerName} onChange={updateForm} minLength={2} maxLength={150} required />
              </label>
              <label>Customer email
                <input name="customerEmail" type="email" value={form.customerEmail} onChange={updateForm} />
              </label>
              <label>Customer phone
                <input name="customerPhone" value={form.customerPhone} onChange={updateForm} maxLength={30} />
              </label>
              <label className="full-field">Service address *
                <input name="serviceAddress" value={form.serviceAddress} onChange={updateForm} minLength={5} maxLength={1000} required />
              </label>
              <label>Priority
                <select name="priority" value={form.priority} onChange={updateForm}>
                  {PRIORITIES.map((priority) => <option key={priority}>{priority}</option>)}
                </select>
              </label>
              <label>Status
                <select name="status" value={form.status} onChange={updateForm}>
                  {['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map((status) => (
                    <option key={status}>{status}</option>
                  ))}
                </select>
              </label>
              <label>Scheduled start
                <input name="scheduledStart" type="datetime-local" value={form.scheduledStart} onChange={updateForm} />
              </label>
              <label>Scheduled end
                <input name="scheduledEnd" type="datetime-local" value={form.scheduledEnd} onChange={updateForm} />
              </label>
              <label className="full-field">Description
                <textarea name="description" value={form.description} onChange={updateForm} maxLength={5000} rows={4} />
              </label>
              <div className="form-actions full-field">
                <button type="button" className="secondary-button" onClick={() => setEditing(false)}>Cancel</button>
                <button type="submit" className="primary-button" disabled={saving}>
                  {saving ? 'Saving...' : 'Save changes'}
                </button>
              </div>
            </form>
          ) : (
            <>
              <dl className="detail-grid">
                <div><dt>Customer</dt><dd>{order.customer_name}</dd></div>
                <div><dt>Status</dt><dd><span className={`status status-${order.status.toLowerCase()}`}>{order.status.replaceAll('_', ' ')}</span></dd></div>
                <div><dt>Priority</dt><dd>{order.priority}</dd></div>
                <div><dt>Service address</dt><dd>{order.service_address}</dd></div>
                <div><dt>Customer email</dt><dd>{order.customer_email || 'Not provided'}</dd></div>
                <div><dt>Customer phone</dt><dd>{order.customer_phone || 'Not provided'}</dd></div>
                <div><dt>Scheduled start</dt><dd>{order.scheduled_start ? new Date(order.scheduled_start).toLocaleString() : 'Not scheduled'}</dd></div>
                <div><dt>Scheduled end</dt><dd>{order.scheduled_end ? new Date(order.scheduled_end).toLocaleString() : 'Not scheduled'}</dd></div>
                <div className="full-field"><dt>Description</dt><dd>{order.description || 'No description provided.'}</dd></div>
              </dl>

              {canManage && (
                <div className="detail-actions">
                  <label>Assigned technician
                    <select
                      aria-label="Assign technician"
                      value={order.assigned_technician_id || ''}
                      onChange={handleAssignment}
                      disabled={saving || technicians.length === 0}
                    >
                      <option value="">Select technician</option>
                      {technicians.map((technician) => (
                        <option key={technician.id} value={technician.id}>
                          {technician.name} ({technician.email})
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="secondary-button" onClick={startEditing}>Edit work order</button>
                  {isOwner && (
                    <button className="danger-button" onClick={handleDelete} disabled={saving}>
                      Delete work order
                    </button>
                  )}
                </div>
              )}

              {isTechnician && order.assigned_technician_id === user.id && (
                <form className="progress-form" onSubmit={submitProgress}>
                  <h3>Submit progress update</h3>
                  <label>Update type
                    <select value={progressType} onChange={(event) => setProgressType(event.target.value)}>
                      <option value="status_changed">Change work-order status</option>
                      <option value="note_added">Add progress note</option>
                    </select>
                  </label>
                  {progressType === 'status_changed' ? (
                    <label>New status
                      <select value={progressStatus} onChange={(event) => setProgressStatus(event.target.value)}>
                        <option value="IN_PROGRESS">In progress</option>
                        <option value="COMPLETED">Completed</option>
                      </select>
                    </label>
                  ) : (
                    <label>Progress note
                      <textarea
                        value={progressNote}
                        onChange={(event) => setProgressNote(event.target.value)}
                        maxLength={5000}
                        required
                      />
                    </label>
                  )}
                  <button className="primary-button" type="submit" disabled={submittingProgress}>
                    {submittingProgress ? 'Submitting...' : 'Submit progress'}
                  </button>
                </form>
              )}

              <section className="activity-section">
                <h3>Progress and activity history</h3>
                {activities.length === 0 ? <p className="state-message">No activity recorded yet.</p> : (
                  <ol className="activity-list">
                    {activities.map((activity, index) => {
                      const safeActivity = isRecord(activity) ? activity : {}
                      const timestamp = typeof safeActivity.created_at === 'string' ||
                        safeActivity.created_at instanceof Date
                        ? safeActivity.created_at
                        : null
                      const actorName = getActivityActorName(safeActivity)

                      return (
                        <li key={safeActivity.id || `activity-${index}`}>
                          <div className="activity-entry-heading">
                            <div className="activity-entry-title">
                              <strong>{getActivityTitle(safeActivity.action)}</strong>
                              {actorName && <span className="activity-actor">by {actorName}</span>}
                            </div>
                            <time dateTime={timestamp instanceof Date ? timestamp.toISOString() : timestamp || undefined}>
                              {formatActivityTimestamp(timestamp)}
                            </time>
                          </div>
                          <ul className="activity-descriptions">
                            {getActivityDescriptions(safeActivity).map((description, descriptionIndex) => (
                              <li key={`${safeActivity.id || index}-${descriptionIndex}`}>
                                {description}
                              </li>
                            ))}
                          </ul>
                        </li>
                      )
                    })}
                  </ol>
                )}
              </section>
            </>
          )}
        </>
      )}
    </section>
  )
}

export default WorkOrderDetails
