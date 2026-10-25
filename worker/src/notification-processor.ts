import { randomUUID } from "node:crypto";
import { UnrecoverableError } from "bullmq";
import type { Pool } from "pg";

export interface NotificationJobData {
  workOrderId: string;
  organizationId: string;
  technicianId: string;
  technicianEmail: string;
  technicianName: string;
  workOrderTitle: string;
}

export type MockDeliveryResult =
  | "delivered"
  | "temporary_failure"
  | "permanent_failure";

export interface NotificationProvider {
  send(
    data: NotificationJobData,
    attempt: number,
  ): Promise<MockDeliveryResult>;
}

interface NotificationJob {
  id?: string;
  data: NotificationJobData;
  attemptsMade: number;
  opts: { attempts?: number };
}

export async function processNotificationJob(
  job: NotificationJob,
  dependencies: {
    pool: Pool;
    provider: NotificationProvider;
  },
) {
  const attempt = job.attemptsMade + 1;
  const maxAttempts = job.opts.attempts ?? 1;
  const outcome = await dependencies.provider.send(job.data, attempt);
  const terminalFailure =
    outcome === "permanent_failure" ||
    (outcome === "temporary_failure" && attempt >= maxAttempts);
  const status =
    outcome === "delivered"
      ? "DELIVERED"
      : terminalFailure
        ? "FAILED"
        : "RETRYING";
  const errorMessage =
    outcome === "delivered"
      ? null
      : outcome === "permanent_failure"
        ? "Permanent notification provider failure"
        : "Temporary notification provider failure";
  const jobId = job.id ?? `notify-${job.data.workOrderId}-${job.data.technicianId}`;

  const client = await dependencies.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO notification_deliveries (
         id, job_id, organization_id, work_order_id, technician_id,
         status, attempt_count, attempt_history, last_error, completed_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         jsonb_build_array(jsonb_build_object(
           'attempt', $7::integer, 'outcome', $8::text, 'occurredAt', NOW()
         )),
         $9,
         CASE WHEN $10 THEN NOW() ELSE NULL END
       )
       ON CONFLICT (job_id) DO UPDATE SET
         status = EXCLUDED.status,
         attempt_count = EXCLUDED.attempt_count,
         attempt_history =
           notification_deliveries.attempt_history || EXCLUDED.attempt_history,
         last_error = EXCLUDED.last_error,
         updated_at = NOW(),
         completed_at = EXCLUDED.completed_at`,
      [
        randomUUID(),
        jobId,
        job.data.organizationId,
        job.data.workOrderId,
        job.data.technicianId,
        status,
        attempt,
        outcome,
        errorMessage,
        terminalFailure || outcome === "delivered",
      ],
    );
    await client.query(
      "SELECT pg_notify($1, $2)",
      [
        "fielddesk_realtime_events",
        JSON.stringify({
          organizationId: job.data.organizationId,
          workOrderId: job.data.workOrderId,
          type: "notification.delivery.updated",
          occurredAt: new Date().toISOString(),
        }),
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (outcome === "delivered") {
    return { outcome, attempt };
  }

  if (outcome === "permanent_failure") {
    throw new UnrecoverableError(errorMessage!);
  }

  throw new Error(errorMessage!);
}
