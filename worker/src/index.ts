import "dotenv/config";
import { Job, Worker } from "bullmq";
import IORedis from "ioredis";
import pg from "pg";
import pino from "pino";
import {
  type NotificationJobData,
  type NotificationProvider,
  processNotificationJob,
} from "./notification-processor.js";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  base: { service: "fielddesk-worker" },
});

const redisUrl = process.env.REDIS_URL || "redis://localhost:6380";
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
const databasePool = new pg.Pool();

class MockNotificationProvider implements NotificationProvider {
  private readonly mode = this.getMode();

  async send(
    data: NotificationJobData,
    attempt: number,
  ): Promise<"delivered" | "temporary_failure" | "permanent_failure"> {
    logger.info(
      {
        workOrderId: data.workOrderId,
        organizationId: data.organizationId,
        technicianId: data.technicianId,
        attempt,
        mode: this.mode,
      },
      "Mock notification provider invoked",
    );

    if (this.mode === "success") return "delivered";
    if (this.mode === "permanent_failure") return "permanent_failure";
    if (
      this.mode === "temporary_failure" ||
      (this.mode === "temporary_once" && attempt === 1)
    ) {
      return "temporary_failure";
    }
    return "delivered";
  }

  private getMode():
    | "success"
    | "temporary_failure"
    | "permanent_failure"
    | "temporary_once" {
    const mode = process.env.MOCK_NOTIFICATION_MODE || "temporary_once";
    switch (mode) {
      case "success":
      case "temporary_failure":
      case "permanent_failure":
      case "temporary_once":
        return mode;
      default:
        throw new Error(
          "MOCK_NOTIFICATION_MODE must be success, temporary_failure, permanent_failure, or temporary_once",
        );
    }
  }
}

const provider = new MockNotificationProvider();
const worker = new Worker<NotificationJobData>(
  "notifications",
  (job: Job<NotificationJobData>) =>
    processNotificationJob(job, { pool: databasePool, provider }),
  {
    connection,
    concurrency: 5,
    limiter: { max: 10, duration: 1000 },
  },
);

worker.on("completed", (job, result) => {
  logger.info(
    { jobId: job.id, workOrderId: job.data.workOrderId, result },
    "Notification job completed",
  );
});

worker.on("failed", (job, error) => {
  logger.error(
    {
      jobId: job?.id,
      workOrderId: job?.data.workOrderId,
      attemptsMade: job?.attemptsMade,
      error: error.message,
    },
    "Notification job failed",
  );
});

worker.on("error", (error) => {
  logger.error({ error }, "Worker error");
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Shutting down worker");
  try {
    await worker.close();
    await connection.quit();
    await databasePool.end();
  } catch (error) {
    logger.error({ error }, "Worker shutdown failed");
    process.exitCode = 1;
    return;
  }
  logger.info("Worker shutdown complete");
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

logger.info("FieldDesk notification worker started");
