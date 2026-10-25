import { pool } from "../config/database.js";

export interface DashboardCounts {
  total: number;
  open: number;
  assigned: number;
  inProgress: number;
  completed: number;
  cancelled: number;
}

export async function getDashboardCounts(
  organizationId: string,
  assignedTechnicianId?: string,
): Promise<DashboardCounts> {
  const values: unknown[] = [organizationId];
  let query = `
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'OPEN')::int AS open,
      COUNT(*) FILTER (WHERE status = 'ASSIGNED')::int AS assigned,
      COUNT(*) FILTER (WHERE status = 'IN_PROGRESS')::int AS in_progress,
      COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed,
      COUNT(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled
    FROM work_orders
    WHERE organization_id = $1
      AND deleted_at IS NULL
  `;

  if (assignedTechnicianId) {
    values.push(assignedTechnicianId);
    query += ` AND assigned_technician_id = $2`;
  }

  const result = await pool.query(query, values);

  return {
    total: result.rows[0].total,
    open: result.rows[0].open,
    assigned: result.rows[0].assigned,
    inProgress: result.rows[0].in_progress,
    completed: result.rows[0].completed,
    cancelled: result.rows[0].cancelled,
  };
}
