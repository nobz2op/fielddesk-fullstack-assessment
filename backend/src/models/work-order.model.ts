import { randomUUID } from "node:crypto";
import { pool } from "../config/database.js";

export type WorkOrderPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export type WorkOrderStatus =
  | "OPEN"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED";

export interface CreateWorkOrderInput {
  organizationId: string;
  createdBy: string;
  title: string;
  description?: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  serviceAddress: string;
  priority?: WorkOrderPriority;
  scheduledStart?: string;
  scheduledEnd?: string;
}

export async function createWorkOrder(input: CreateWorkOrderInput) {
  const client = await pool.connect();
  const id = randomUUID();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `INSERT INTO work_orders (
        id, organization_id, title, description,
        customer_name, customer_email, customer_phone,
        service_address, priority, scheduled_start,
        scheduled_end, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        id,
        input.organizationId,
        input.title,
        input.description ?? null,
        input.customerName,
        input.customerEmail ?? null,
        input.customerPhone ?? null,
        input.serviceAddress,
        input.priority ?? "MEDIUM",
        input.scheduledStart ?? null,
        input.scheduledEnd ?? null,
        input.createdBy,
      ],
    );

    const workOrder = result.rows[0];

    await client.query(
      `INSERT INTO work_order_activities (
        id, organization_id, work_order_id,
        actor_user_id, action, details
      )
      VALUES ($1, $2, $3, $4, 'CREATED', $5)`,
      [
        randomUUID(),
        input.organizationId,
        id,
        input.createdBy,
        JSON.stringify({ title: input.title }),
      ],
    );

    await client.query("COMMIT");
    return workOrder;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export interface ListWorkOrdersOptions {
  status?: WorkOrderStatus;
  priority?: WorkOrderPriority;
  search?: string;
  sortBy?: "created_at" | "scheduled_start" | "priority" | "title";
  sortOrder?: "asc" | "desc";
  page?: number;
  limit?: number;
}

export async function listWorkOrders(
  organizationId: string,
  options: ListWorkOrdersOptions = {},
) {
  const {
    status,
    priority,
    search,
    sortBy = "created_at",
    sortOrder = "desc",
    page = 1,
    limit = 10,
  } = options;

  const conditions = ["organization_id = $1"];
  const values: unknown[] = [organizationId];

  if (status) {
    values.push(status);
    conditions.push(`status = $${values.length}`);
  }

  if (priority) {
    values.push(priority);
    conditions.push(`priority = $${values.length}`);
  }

  if (search) {
    values.push(`%${search}%`);
    conditions.push(
      `(title ILIKE $${values.length} OR customer_name ILIKE $${values.length})`,
    );
  }

  const whereClause = conditions.join(" AND ");

  // These values come from fixed allowlists, not directly from user input.
  const sortColumns = {
    created_at: "created_at",
    scheduled_start: "scheduled_start",
    priority: "priority",
    title: "title",
  } as const;

  const orderColumn = sortColumns[sortBy];
  const orderDirection = sortOrder === "asc" ? "ASC" : "DESC";

  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 100);
  const safePage = Math.max(Math.floor(page), 1);
  const offset = (safePage - 1) * safeLimit;

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM work_orders
     WHERE ${whereClause}`,
    values,
  );

  const total = countResult.rows[0].total as number;

  const result = await pool.query(
    `SELECT *
     FROM work_orders
     WHERE ${whereClause}
     ORDER BY ${orderColumn} ${orderDirection} NULLS LAST, id ASC
     LIMIT $${values.length + 1}
     OFFSET $${values.length + 2}`,
    [...values, safeLimit, offset],
  );

  return {
    items: result.rows,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit),
    },
  };
}

export async function findWorkOrderById(
  workOrderId: string,
  organizationId: string,
) {
  const result = await pool.query(
    `SELECT *
     FROM work_orders
     WHERE id = $1
       AND organization_id = $2`,
    [workOrderId, organizationId],
  );

  return result.rows[0] ?? null;
}

export interface UpdateWorkOrderInput {
  title?: string;
  description?: string | null;
  customerName?: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  serviceAddress?: string;
  priority?: WorkOrderPriority;
  status?: WorkOrderStatus;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
}

export async function updateWorkOrder(
  workOrderId: string,
  organizationId: string,
  input: UpdateWorkOrderInput,
  actorUserId: string,
) {
  const client = await pool.connect();

  const columnMap: Record<keyof UpdateWorkOrderInput, string> = {
    title: "title",
    description: "description",
    customerName: "customer_name",
    customerEmail: "customer_email",
    customerPhone: "customer_phone",
    serviceAddress: "service_address",
    priority: "priority",
    status: "status",
    scheduledStart: "scheduled_start",
    scheduledEnd: "scheduled_end",
  };

  try {
    await client.query("BEGIN");

    const existingResult = await client.query(
      `SELECT *
       FROM work_orders
       WHERE id = $1 AND organization_id = $2
       FOR UPDATE`,
      [workOrderId, organizationId],
    );

    const existing = existingResult.rows[0];

    if (!existing) {
      await client.query("ROLLBACK");
      return null;
    }

    const entries = Object.entries(input) as [
      keyof UpdateWorkOrderInput,
      UpdateWorkOrderInput[keyof UpdateWorkOrderInput],
    ][];

    if (entries.length === 0) {
      await client.query("ROLLBACK");
      return null;
    }

    const setClauses = entries.map(
      ([key], index) => `${columnMap[key]} = $${index + 1}`,
    );

    const values = entries.map(([, value]) => value ?? null);

    const result = await client.query(
      `UPDATE work_orders
       SET ${setClauses.join(", ")}, updated_at = NOW()
       WHERE id = $${values.length + 1}
         AND organization_id = $${values.length + 2}
       RETURNING *`,
      [...values, workOrderId, organizationId],
    );

    const updated = result.rows[0];

    const changes = Object.fromEntries(
      entries.map(([key, value]) => [
        key,
        {
          from: existing[columnMap[key]],
          to: value ?? null,
        },
      ]),
    );

    const action = entries.some(([key]) => key === "status")
      ? "STATUS_CHANGED"
      : "UPDATED";

    await client.query(
      `INSERT INTO work_order_activities (
        id, organization_id, work_order_id,
        actor_user_id, action, details
      )
      VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        randomUUID(),
        organizationId,
        workOrderId,
        actorUserId,
        action,
        JSON.stringify({ changes }),
      ],
    );

    await client.query("COMMIT");
    return updated;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteWorkOrder(
  workOrderId: string,
  organizationId: string,
) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT id
       FROM work_orders
       WHERE id = $1 AND organization_id = $2
       FOR UPDATE`,
      [workOrderId, organizationId],
    );

    if (existing.rows.length === 0) {
      await client.query("ROLLBACK");
      return null;
    }

    const activities = await client.query(
      `SELECT 1
       FROM work_order_activities
       WHERE work_order_id = $1
         AND organization_id = $2
       LIMIT 1`,
      [workOrderId, organizationId],
    );

    if (activities.rows.length > 0) {
      await client.query("ROLLBACK");
      return { blocked: true as const };
    }

    const deleted = await client.query(
      `DELETE FROM work_orders
       WHERE id = $1 AND organization_id = $2
       RETURNING id`,
      [workOrderId, organizationId],
    );

    await client.query("COMMIT");
    return { deleted: deleted.rows[0] };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function assignWorkOrder(
  workOrderId: string,
  organizationId: string,
  technicianId: string,
  actorUserId: string,
) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `UPDATE work_orders AS wo
       SET assigned_technician_id = $3,
           status = CASE
             WHEN wo.status = 'OPEN' THEN 'ASSIGNED'
             ELSE wo.status
           END,
           updated_at = NOW()
       WHERE wo.id = $1
         AND wo.organization_id = $2
         AND EXISTS (
           SELECT 1
           FROM users AS u
           WHERE u.id = $3
             AND u.organization_id = $2
             AND u.role = 'TECHNICIAN'
             AND u.is_active = TRUE
         )
       RETURNING wo.*`,
      [workOrderId, organizationId, technicianId],
    );

    const workOrder = result.rows[0];

    if (!workOrder) {
      await client.query("ROLLBACK");
      return null;
    }

    await client.query(
      `INSERT INTO work_order_activities (
         id,
         organization_id,
         work_order_id,
         actor_user_id,
         action,
         details
       )
       VALUES ($1, $2, $3, $4, 'ASSIGNED', $5)`,
      [
        randomUUID(),
        organizationId,
        workOrderId,
        actorUserId,
        JSON.stringify({
          technicianId,
          status: workOrder.status,
        }),
      ],
    );

    await client.query("COMMIT");

    return workOrder;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
