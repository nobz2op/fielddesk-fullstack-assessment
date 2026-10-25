import dotenv from "dotenv";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { UnrecoverableError } from "bullmq";
import {
  type NotificationJobData,
  type NotificationProvider,
  processNotificationJob,
} from "../src/notification-processor.js";

dotenv.config({ path: "../backend/.env" });

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) {
  throw new Error("TEST_DATABASE_URL is required; refusing to use DATABASE_URL.");
}

const pool = new pg.Pool({ connectionString });
const organizations: string[] = [];

async function createJob(
  jobId: string,
  data: NotificationJobData,
  attemptsMade = 0,
) {
  return {
    id: jobId,
    data,
    attemptsMade,
    opts: { attempts: 3 },
  };
}

async function createFixture() {
  const organizationId = randomUUID();
  const ownerId = randomUUID();
  const technicianId = randomUUID();
  const workOrderId = randomUUID();
  await pool.query("INSERT INTO organizations (id, name) VALUES ($1, $2)", [
    organizationId,
    "Notification Test Organization",
  ]);
  organizations.push(organizationId);
  await pool.query(
    `INSERT INTO users
       (id, organization_id, name, email, password_hash, role)
     VALUES
       ($1, $3, 'Notification Test Owner', $4, 'test-hash', 'OWNER'),
       ($2, $3, 'Notification Test Technician', $5, 'test-hash', 'TECHNICIAN')`,
    [
      ownerId,
      technicianId,
      organizationId,
      `${ownerId}@example.test`,
      `${technicianId}@example.test`,
    ],
  );
  await pool.query(
    `INSERT INTO work_orders
       (id, organization_id, title, customer_name, service_address, created_by)
     VALUES ($1, $2, 'Notification test work order', 'Test Customer',
             '123 Test Street', $3)`,
    [workOrderId, organizationId, ownerId],
  );

  return {
    organizationId,
    workOrderId,
    technicianId,
    data: {
      organizationId,
      workOrderId,
      technicianId,
      technicianEmail: `${technicianId}@example.test`,
      technicianName: "Notification Test Technician",
      workOrderTitle: "Notification test work order",
    } satisfies NotificationJobData,
  };
}

describe("Notification delivery persistence", () => {
  beforeAll(async () => {
    const result = await pool.query("SELECT current_database() AS name");
    if (result.rows[0].name !== "fielddesk_test") {
      throw new Error(
        `Safety check failed: connected to ${result.rows[0].name}, not fielddesk_test`,
      );
    }
    await pool.query("SELECT 1 FROM notification_deliveries LIMIT 0");
  });

  afterEach(async () => {
    while (organizations.length > 0) {
      const organizationId = organizations.pop()!;
      await pool.query(
        "DELETE FROM notification_deliveries WHERE organization_id = $1",
        [organizationId],
      );
      await pool.query(
        "DELETE FROM work_order_activities WHERE organization_id = $1",
        [organizationId],
      );
      await pool.query("DELETE FROM work_orders WHERE organization_id = $1", [
        organizationId,
      ]);
      await pool.query("DELETE FROM users WHERE organization_id = $1", [
        organizationId,
      ]);
      await pool.query("DELETE FROM organizations WHERE id = $1", [
        organizationId,
      ]);
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it("persists a successful notification delivery", async () => {
    const fixture = await createFixture();
    const provider: NotificationProvider = {
      send: async () => "delivered",
    };

    const result = await processNotificationJob(
      await createJob("success-job", fixture.data),
      { pool, provider },
    );

    expect(result).toEqual({ outcome: "delivered", attempt: 1 });
    const delivery = await pool.query(
      `SELECT organization_id, work_order_id, technician_id, status,
              attempt_count, attempt_history, last_error, completed_at,
              actor_type, action
       FROM notification_deliveries WHERE job_id = $1`,
      ["success-job"],
    );
    expect(delivery.rows[0]).toMatchObject({
      organization_id: fixture.organizationId,
      work_order_id: fixture.workOrderId,
      technician_id: fixture.technicianId,
      status: "DELIVERED",
      attempt_count: 1,
      attempt_history: [{ attempt: 1, outcome: "delivered" }],
      last_error: null,
      actor_type: "SYSTEM",
      action: "NOTIFICATION_OUTCOME",
    });
    expect(delivery.rows[0].completed_at).toBeTruthy();
  });

  it("persists a permanent failure and marks the job unrecoverable", async () => {
    const fixture = await createFixture();
    const provider: NotificationProvider = {
      send: async () => "permanent_failure",
    };

    await expect(
      processNotificationJob(await createJob("failed-job", fixture.data), {
        pool,
        provider,
      }),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    const delivery = await pool.query(
      `SELECT organization_id, work_order_id, status, attempt_count,
              attempt_history, last_error, completed_at, actor_type, action
       FROM notification_deliveries WHERE job_id = $1`,
      ["failed-job"],
    );
    expect(delivery.rows[0]).toMatchObject({
      organization_id: fixture.organizationId,
      work_order_id: fixture.workOrderId,
      status: "FAILED",
      attempt_count: 1,
      attempt_history: [{ attempt: 1, outcome: "permanent_failure" }],
      last_error: "Permanent notification provider failure",
      actor_type: "SYSTEM",
      action: "NOTIFICATION_OUTCOME",
    });
    expect(delivery.rows[0].completed_at).toBeTruthy();
  });

  it("records retryable failures and appends later successful attempts", async () => {
    const fixture = await createFixture();
    const job = await createJob("retry-job", fixture.data);
    const provider: NotificationProvider = {
      send: async (_data, attempt) =>
        attempt === 1 ? "temporary_failure" : "delivered",
    };

    await expect(
      processNotificationJob(job, { pool, provider }),
    ).rejects.toThrow("Temporary notification provider failure");
    const retrying = await pool.query(
      "SELECT status, attempt_count FROM notification_deliveries WHERE job_id = $1",
      ["retry-job"],
    );
    expect(retrying.rows[0]).toEqual({ status: "RETRYING", attempt_count: 1 });

    await processNotificationJob(
      { ...job, attemptsMade: 1 },
      { pool, provider },
    );
    const delivered = await pool.query(
      `SELECT status, attempt_count, attempt_history
       FROM notification_deliveries WHERE job_id = $1`,
      ["retry-job"],
    );
    expect(delivered.rows[0]).toMatchObject({
      status: "DELIVERED",
      attempt_count: 2,
      attempt_history: [
        { attempt: 1, outcome: "temporary_failure" },
        { attempt: 2, outcome: "delivered" },
      ],
    });
  });
});
