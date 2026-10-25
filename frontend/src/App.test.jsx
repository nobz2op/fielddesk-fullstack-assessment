import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  getWorkOrders: vi.fn(),
  createWorkOrder: vi.fn(),
  getTechnicians: vi.fn(),
  assignWorkOrder: vi.fn(),
  getWorkOrder: vi.fn(),
  getWorkOrderActivities: vi.fn(),
  updateWorkOrder: vi.fn(),
  deleteWorkOrder: vi.fn(),
  createProgressEvent: vi.fn(),
  consumeRealtimeEvents: vi.fn(),
}))

vi.mock('./services/api', () => ({ apiRequest: mocks.apiRequest }))
vi.mock('./services/workOrders', () => ({
  getWorkOrders: mocks.getWorkOrders,
  createWorkOrder: mocks.createWorkOrder,
  getTechnicians: mocks.getTechnicians,
  assignWorkOrder: mocks.assignWorkOrder,
  getWorkOrder: mocks.getWorkOrder,
  getWorkOrderActivities: mocks.getWorkOrderActivities,
  updateWorkOrder: mocks.updateWorkOrder,
  deleteWorkOrder: mocks.deleteWorkOrder,
  createProgressEvent: mocks.createProgressEvent,
}))
vi.mock('./services/realtime', () => ({
  consumeRealtimeEvents: mocks.consumeRealtimeEvents,
}))

function saveSession(user) {
  sessionStorage.setItem('fielddesk_token', 'test-token')
  sessionStorage.setItem('fielddesk_user', JSON.stringify(user))
}

const owner = {
  id: 'owner-id',
  name: 'Test Owner',
  email: 'owner@example.test',
  role: 'OWNER',
}

const order = {
  id: 'wo-1',
  title: 'Repair lobby door',
  description: 'Door is sticking',
  service_address: '100 Main Street',
  customer_name: 'Northstar Office',
  customer_email: 'office@example.test',
  customer_phone: '555-0100',
  priority: 'HIGH',
  status: 'ASSIGNED',
  assigned_technician_id: 'tech-id',
  scheduled_start: '2026-10-25T10:00:00.000Z',
  scheduled_end: '2026-10-25T11:00:00.000Z',
}

function renderDashboard(user = owner) {
  saveSession(user)
  return render(<App />)
}

async function openDetailsWithActivities(activities) {
  const user = userEvent.setup()
  mocks.getWorkOrders.mockResolvedValue({
    data: [order],
    pagination: { page: 1, total: 1, totalPages: 1 },
  })
  mocks.getWorkOrderActivities.mockResolvedValue({ data: activities })
  const result = renderDashboard()

  await user.click(await screen.findByRole('button', { name: 'View details' }))
  await screen.findByRole('heading', { name: 'Progress and activity history' })
  return result
}

describe('FieldDesk frontend workflows', () => {
  beforeEach(() => {
    cleanup()
    sessionStorage.clear()
    vi.clearAllMocks()
    mocks.getWorkOrders.mockResolvedValue({
      data: [],
      pagination: { page: 1, total: 0, totalPages: 0 },
    })
    mocks.getTechnicians.mockResolvedValue({ data: [] })
    mocks.getWorkOrder.mockImplementation(async () => ({ data: order }))
    mocks.getWorkOrderActivities.mockResolvedValue({
      data: [{
        id: 'activity-1',
        action: 'STATUS_CHANGED',
        details: { status: 'ASSIGNED' },
        created_at: '2026-10-24T10:00:00.000Z',
      }],
    })
    mocks.updateWorkOrder.mockImplementation(async (_id, updates) => ({
      data: { ...order, ...updates, title: updates.title || order.title },
    }))
    mocks.assignWorkOrder.mockResolvedValue({ data: order })
    mocks.deleteWorkOrder.mockResolvedValue({ message: 'Deleted' })
    mocks.createProgressEvent.mockResolvedValue({ success: true })
    mocks.consumeRealtimeEvents.mockImplementation(
      ({ signal }) => new Promise((resolve) => {
        signal.addEventListener('abort', resolve, { once: true })
      }),
    )
  })

  it('logs in with the entered organization and credentials', async () => {
    const user = userEvent.setup()
    mocks.apiRequest.mockResolvedValue({ token: 'received-token', user: owner })
    render(<App />)

    await user.type(screen.getByLabelText('Organization ID'), 'org-123')
    await user.type(screen.getByLabelText('Email address'), 'owner@example.test')
    await user.type(screen.getByLabelText('Password'), 'assessment-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('heading', { name: 'Work orders' })).toBeTruthy()
    expect(mocks.apiRequest).toHaveBeenCalledWith('/auth/login', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        organizationId: 'org-123',
        email: 'owner@example.test',
        password: 'assessment-password',
      }),
    }))
    expect(sessionStorage.getItem('fielddesk_token')).toBe('received-token')
  })

  it('lists persisted work orders returned by the API', async () => {
    mocks.getWorkOrders.mockResolvedValue({
      data: [{
        id: 'wo-1',
        title: 'Repair lobby door',
        service_address: '100 Main Street',
        customer_name: 'Northstar Office',
        priority: 'HIGH',
        status: 'OPEN',
        assigned_technician_id: null,
        scheduled_start: null,
      }],
      pagination: { page: 1, total: 1, totalPages: 1 },
    })

    renderDashboard()

    expect(await screen.findByText('Repair lobby door')).toBeTruthy()
    expect(screen.getByText('Northstar Office')).toBeTruthy()
    expect(mocks.getWorkOrders).toHaveBeenCalledWith(expect.objectContaining({
      page: 1,
      limit: 10,
    }))
  })

  it('shows loading and an API error state for a failed work-order request', async () => {
    mocks.getWorkOrders.mockImplementation(
      () => new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Work-order service unavailable')), 25)
      }),
    )

    renderDashboard()

    expect(screen.getByText('Loading work orders...')).toBeTruthy()
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Work-order service unavailable',
    )
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('hides work-order creation and assignment controls from technicians', async () => {
    const technician = {
      id: 'tech-id',
      name: 'Test Technician',
      email: 'tech@example.test',
      role: 'TECHNICIAN',
    }
    mocks.getWorkOrders.mockResolvedValue({
      data: [{
        id: 'assigned-order',
        title: 'Assigned repair',
        service_address: '200 Main Street',
        customer_name: 'Customer',
        priority: 'MEDIUM',
        status: 'ASSIGNED',
        assigned_technician_id: technician.id,
        scheduled_start: null,
      }],
      pagination: { page: 1, total: 1, totalPages: 1 },
    })

    renderDashboard(technician)

    expect(await screen.findByText('Assigned repair')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '+ New work order' })).toBeNull()
    expect(screen.queryByLabelText('Assign technician to Assigned repair')).toBeNull()
    await waitFor(() => expect(mocks.getTechnicians).not.toHaveBeenCalled())
  })

  it('opens an owner detail view with activity and saves permitted fields and schedule', async () => {
    const user = userEvent.setup()
    mocks.getWorkOrders.mockResolvedValue({
      data: [order],
      pagination: { page: 1, total: 1, totalPages: 1 },
    })
    renderDashboard()

    await user.click(await screen.findByRole('button', { name: 'View details' }))
    expect(await screen.findByRole('heading', { name: 'Repair lobby door' })).toBeTruthy()
    expect(screen.getByText('Progress and activity history')).toBeTruthy()
    expect(screen.getByText('Status changed')).toBeTruthy()
    expect(screen.getByText('Status changed to Assigned')).toBeTruthy()
    expect(screen.getByLabelText('Assign technician')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Edit work order' }))
    expect(screen.getByLabelText('Scheduled start')).toBeTruthy()
    expect(screen.getByLabelText('Scheduled end')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'Updated lobby door' } })
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(mocks.updateWorkOrder).toHaveBeenCalledWith(
      'wo-1',
      expect.objectContaining({
        title: 'Updated lobby door',
        scheduledStart: '2026-10-25T10:00:00.000Z',
        scheduledEnd: '2026-10-25T11:00:00.000Z',
      }),
    ))
  })

  it('formats multiple changes, hides unchanged fields and safely masks contact details', async () => {
    const scheduledEnd = '2026-10-25T11:00:00.000Z'
    const formattedScheduledEnd = new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(scheduledEnd))
    const { container } = await openDetailsWithActivities([{
      id: 'activity-changes',
      action: 'STATUS_CHANGED',
      actor_name: 'Ada Dispatcher',
      created_at: '2026-10-25T10:00:00.000Z',
      details: {
        changes: {
          status: { from: 'COMPLETED', to: 'CANCELLED' },
          priority: { from: 'HIGH', to: 'LOW' },
          title: { from: 'Old title', to: 'New title' },
          customerName: { from: 'Old customer', to: 'New customer' },
          scheduledEnd: { from: '2026-10-25T10:30:00.000Z', to: scheduledEnd },
          customerEmail: { from: 'private@example.test', to: 'new-private@example.test' },
          customerPhone: { from: '555-0101', to: '555-0199' },
          description: { from: 'Same value', to: 'Same value' },
          isEmergency: { from: false, to: true },
          attemptCount: { from: 0, to: 2 },
          notes: { from: null, to: '' },
        },
      },
    }])

    expect(screen.getByText('Status changed from Completed to Cancelled')).toBeTruthy()
    expect(screen.getByText('Priority changed from High to Low')).toBeTruthy()
    expect(screen.getByText('Title changed from Old title to New title')).toBeTruthy()
    expect(screen.getByText('Customer name changed from Old customer to New customer')).toBeTruthy()
    expect(screen.getByText(`Scheduled end changed from ${new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date('2026-10-25T10:30:00.000Z'))} to ${formattedScheduledEnd}`)).toBeTruthy()
    expect(screen.getByText('Customer email updated')).toBeTruthy()
    expect(screen.getByText('Customer phone updated')).toBeTruthy()
    expect(screen.getByText('Is Emergency changed from No to Yes')).toBeTruthy()
    expect(screen.getByText('Attempt Count changed from 0 to 2')).toBeTruthy()
    expect(screen.getByText('by Ada Dispatcher')).toBeTruthy()
    expect(screen.queryByText(/Same value/)).toBeNull()
    expect(container.textContent).not.toContain('private@example.test')
    expect(container.textContent).not.toContain('555-0101')
    expect(container.textContent).not.toContain('[object Object]')
    expect(container.textContent).not.toContain('"changes"')

    const time = container.querySelector('time')
    expect(time.dateTime).toBe('2026-10-25T10:00:00.000Z')
    expect(time.textContent).not.toBe('2026-10-25T10:00:00.000Z')
  })

  it('describes assignment and progress activities without exposing identifiers or private payloads', async () => {
    const { container } = await openDetailsWithActivities([
      {
        id: 'activity-assigned',
        action: 'ASSIGNED',
        created_at: '2026-10-25T10:00:00.000Z',
        details: { technicianId: 'private-technician-id', status: 'ASSIGNED' },
      },
      {
        id: 'activity-note',
        action: 'NOTE_ADDED',
        created_at: '2026-10-25T10:05:00.000Z',
        details: {
          eventType: 'note_added',
          eventId: 'private-event-id',
          note: 'Private customer access code',
        },
      },
      {
        id: 'activity-progress',
        action: 'EVENT_SUBMITTED',
        created_at: '2026-10-25T10:10:00.000Z',
        details: { eventType: 'status_changed', status: 'IN_PROGRESS' },
      },
      {
        id: 'activity-location',
        action: 'LOCATION_UPDATED',
        created_at: '2026-10-25T10:15:00.000Z',
        details: { location: 'Private customer location' },
      },
    ])

    expect(screen.getByText('Technician assigned')).toBeTruthy()
    expect(screen.getByText('Work order status: Assigned')).toBeTruthy()
    expect(screen.getByText('Progress note added')).toBeTruthy()
    expect(screen.getByText('A progress note was added.')).toBeTruthy()
    expect(screen.getByText('Progress event recorded')).toBeTruthy()
    expect(screen.getByText('Status changed to In Progress')).toBeTruthy()
    expect(screen.getByText('Location updated')).toBeTruthy()
    expect(screen.getByText('Work location updated.')).toBeTruthy()
    expect(container.textContent).not.toContain('private-technician-id')
    expect(container.textContent).not.toContain('private-event-id')
    expect(container.textContent).not.toContain('Private customer access code')
    expect(container.textContent).not.toContain('Private customer location')
  })

  it('handles missing or malformed metadata, unknown activity types and invalid timestamps', async () => {
    const { container } = await openDetailsWithActivities([
      {
        id: 'activity-unknown',
        action: 'FUTURE_ACTIVITY_TYPE',
        created_at: 'not-a-date',
        details: '{ malformed JSON',
      },
      {
        id: 'activity-malformed',
        action: {},
        created_at: null,
        details: { changes: [{ from: { value: 1 }, to: undefined }] },
      },
      null,
    ])

    expect(screen.getByText('Activity recorded: Future Activity Type')).toBeTruthy()
    expect(screen.getAllByText('No additional details available.')).toHaveLength(3)
    expect(screen.getAllByText('Date unavailable')).toHaveLength(3)
    expect(container.textContent).not.toContain('[object Object]')
    expect(container.textContent).not.toContain('undefined')
    expect(container.textContent).not.toContain('{ malformed JSON')
    expect(container.textContent).not.toContain('"changes"')
  })

  it('allows dispatchers to assign and edit but does not expose delete', async () => {
    const user = userEvent.setup()
    mocks.getWorkOrders.mockResolvedValue({
      data: [order],
      pagination: { page: 1, total: 1, totalPages: 1 },
    })
    mocks.getTechnicians.mockResolvedValue({
      data: [{ id: 'tech-id', name: 'Org Technician', email: 'tech@example.test' }],
    })
    renderDashboard({ ...owner, role: 'DISPATCHER' })

    await user.click(await screen.findByRole('button', { name: 'View details' }))
    await screen.findByRole('heading', { name: 'Repair lobby door' })
    expect(screen.getByRole('button', { name: 'Edit work order' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Delete work order' })).toBeNull()
    expect(screen.getAllByRole('option', { name: 'Org Technician (tech@example.test)' })).toHaveLength(2)
    await user.selectOptions(screen.getByLabelText('Assign technician'), 'tech-id')
    await waitFor(() => expect(mocks.assignWorkOrder).toHaveBeenCalledWith('wo-1', 'tech-id'))
  })

  it('asks an owner to confirm deletion before calling the delete API', async () => {
    const user = userEvent.setup()
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)
    mocks.getWorkOrders.mockResolvedValue({
      data: [order],
      pagination: { page: 1, total: 1, totalPages: 1 },
    })
    renderDashboard()

    await user.click(await screen.findByRole('button', { name: 'View details' }))
    await user.click(await screen.findByRole('button', { name: 'Delete work order' }))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Repair lobby door'))
    expect(mocks.deleteWorkOrder).not.toHaveBeenCalled()

    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Delete work order' }))
    await waitFor(() => expect(mocks.deleteWorkOrder).toHaveBeenCalledWith('wo-1'))
    vi.unstubAllGlobals()
  })

  it('lets an assigned technician submit progress and keeps management actions hidden', async () => {
    const user = userEvent.setup()
    const technician = {
      id: 'tech-id',
      name: 'Test Technician',
      email: 'tech@example.test',
      role: 'TECHNICIAN',
    }
    mocks.getWorkOrders.mockResolvedValue({
      data: [order],
      pagination: { page: 1, total: 1, totalPages: 1 },
    })
    renderDashboard(technician)

    await user.click(await screen.findByRole('button', { name: 'View details' }))
    await screen.findByRole('heading', { name: 'Repair lobby door' })
    expect(screen.getByRole('heading', { name: 'Submit progress update' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit work order' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete work order' })).toBeNull()
    expect(screen.queryByLabelText('Assign technician')).toBeNull()

    await user.selectOptions(screen.getByLabelText('Update type'), 'note_added')
    await user.type(screen.getByLabelText('Progress note'), 'Replaced the door hinge.')
    await user.click(screen.getByRole('button', { name: 'Submit progress' }))
    await waitFor(() => expect(mocks.createProgressEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        workOrderId: 'wo-1',
        type: 'note_added',
        payload: { note: 'Replaced the door hinge.' },
      }),
    ))
  })
})
