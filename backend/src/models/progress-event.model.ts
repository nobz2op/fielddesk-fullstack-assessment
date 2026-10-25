import { randomUUID } from "node:crypto";
import { pool } from "../config/database.js";

export type ProgressEventType =
  | "status_changed"
  | "note_added"
  | "location_updated"
  | "custom";

export interface CreateProgressEventInput {
  eventId: string;
  organizationId: string;
  workOrderId: string;
  submittedBy: string;
  type: ProgressEventType;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export async function createProgressEvent(input: CreateProgressEventInput) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Verify the technician is assigned to the work order
    const workOrderResult = await client.query(
      `SELECT wo.id, wo.status, wo.assigned_technician_id
       FROM work_orders wo
       WHERE wo.id = $1
         AND wo.organization_id = $2
         AND wo.deleted_at IS NULL
       FOR UPDATE`,
      [input.workOrderId, input.organizationId],
    );

    const workOrder = workOrderResult.rows[0];

    if (!workOrder) {
      await client.query("ROLLBACK");
      return { notFound: true as const };
    }

    if (!workOrder.assigned_technician_id) {
      await client.query("ROLLBACK");
      return { notAssigned: true as const };
    }

    if (workOrder.assigned_technician_id !== input.submittedBy) {
      await client.query("ROLLBACK");
      return { unauthorized: true as const };
    }

    // Check for duplicate event_id (idempotency)
    const existingEvent = await client.query(
      `SELECT id, payload
       FROM progress_events
       WHERE work_order_id = $1 AND event_id = $2`,
      [input.workOrderId, input.eventId],
    );

    if (existingEvent.rows.length > 0) {
      await client.query("ROLLBACK");
      return { duplicate: true as const, event: existingEvent.rows[0] };
    }

    // Validate and apply the event payload
    let workOrderUpdate: Record<string, unknown> = {};
    let activityAction: string = "EVENT_SUBMITTED";
    let activityDetails: Record<string, unknown> = {
      eventType: input.type,
      eventId: input.eventId,
    };

    if (input.type === "status_changed") {
      const status = input.payload.status as string;
      const validStatuses = ["ASSIGNED", "IN_PROGRESS", "COMPLETED"];

      if (!validStatuses.includes(status)) {
        await client.query("ROLLBACK");
        return { invalidPayload: true as const, message: "Invalid status value" };
      }

      workOrderUpdate.status = status;
      activityAction = "STATUS_CHANGED";
      activityDetails.status = status;
    } else if (input.type === "note_added") {
      if (!input.payload.note || typeof input.payload.note !== "string") {
        await client.query("ROLLBACK");
        return { invalidPayload: true as const, message: "Note is required" };
      }
      activityAction = "NOTE_ADDED";
      activityDetails.note = input.payload.note;
    } else if (input.type === "location_updated") {
      if (!input.payload.location || typeof input.payload.location !== "string") {
        await client.query("ROLLBACK");
        return { invalidPayload: true as const, message: "Location is required" };
      }
      activityAction = "LOCATION_UPDATED";
      activityDetails.location = input.payload.location;
    }

    // Store the immutable event record
    const eventResult = await client.query(
      `INSERT INTO progress_events (
        id, event_id, organization_id, work_order_id,
        submitted_by, event_type, occurred_at, payload
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        randomUUID(),
        input.eventId,
        input.organizationId,
        input.workOrderId,
        input.submittedBy,
        input.type,
        input.occurredAt,
        JSON.stringify(input.payload),
      ],
    );

    // Update the work order if applicable
    if (Object.keys(workOrderUpdate).length > 0) {
      const updateClauses = Object.keys(workOrderUpdate)
        .map((key, index) => `${snakeCase(key)} = $${index + 1}`)
        .join(", ");

      const updateValues = Object.values(workOrderUpdate);

      await client.query(
        `UPDATE work_orders
         SET ${updateClauses}, updated_at = NOW()
         WHERE id = $${updateValues.length + 1}
           AND organization_id = $${updateValues.length + 2}`,
        [...updateValues, input.workOrderId, input.organizationId],
      );
    }

    // Record activity
    await client.query(
      `INSERT INTO work_order_activities (
        id, organization_id, work_order_id,
        actor_user_id, action, details
      )
      VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        randomUUID(),
        input.organizationId,
        input.workOrderId,
        input.submittedBy,
        activityAction,
        JSON.stringify(activityDetails),
      ],
    );

    await client.query("COMMIT");

    return {
      success: true as const,
      event: eventResult.rows[0],
      workOrderUpdate,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function snakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}
