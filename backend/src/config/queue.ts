import { Queue } from "bullmq";
import IORedis from "ioredis";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6380";

const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
});

export interface NotificationJobData {
  workOrderId: string;
  organizationId: string;
  technicianId: string;
  technicianEmail: string;
  technicianName: string;
  workOrderTitle: string;
}

export const notificationQueue = new Queue<NotificationJobData>("notifications", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
    removeOnComplete: {
      count: 100,
      age: 24 * 60 * 60,
    },
    removeOnFail: {
      count: 50,
      age: 7 * 24 * 60 * 60,
    },
  },
});

export async function enqueueNotification(data: NotificationJobData) {
  const job = await notificationQueue.add("notify-technician", data, {
    jobId: `notify-${data.workOrderId}-${data.technicianId}`,
  });

  return job;
}
