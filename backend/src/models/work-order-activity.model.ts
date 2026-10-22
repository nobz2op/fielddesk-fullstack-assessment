import { randomUUID } from "node:crypto";
import { pool } from "../config/database.js";

export type WorkOrderActivityAction =
  | "CREATED"
  | "UPDATED"
  | "ASSIGNED"
  | "STATUS_CHANGED";

export interface CreateWorkOrderActivityInput {
  organizationId: string;
  workOrderId: string;
  actorUserId: string;
  action: WorkOrderActivityAction;
  details?: Record<string, unknown>;
}

export async function createWorkOrderActivity(
  input: CreateWorkOrderActivityInput,
) {
  const result = await pool.query(
    `INSERT INTO work_order_activities (
      id,
      organization_id,
      work_order_id,
      actor_user_id,
      action,
      details
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *`,
    [
      randomUUID(),
      input.organizationId,
      input.workOrderId,
      input.actorUserId,
      input.action,
      JSON.stringify(input.details ?? {}),
    ],
  );

  return result.rows[0];
}

export async function listWorkOrderActivities(
  workOrderId: string,
  organizationId: string,
) {
  const result = await pool.query(
    `SELECT
       id,
       organization_id,
       work_order_id,
       actor_user_id,
       action,
       details,
       created_at
     FROM work_order_activities
     WHERE work_order_id = $1
       AND organization_id = $2
     ORDER BY created_at DESC, id DESC`,
    [workOrderId, organizationId],
  );

  return result.rows;
}
