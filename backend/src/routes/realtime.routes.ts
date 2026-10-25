import { Client } from "pg";
import { Router } from "express";
import pino from "pino";
import { authenticateToken } from "../middleware/auth.middleware.js";

const router = Router();
const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  base: { service: "fielddesk-realtime" },
});
const channel = "fielddesk_realtime_events";
const openStreams = new Set<import("express").Response>();

export function closeRealtimeStreams(): void {
  for (const response of openStreams) {
    response.write("event: shutdown\ndata: {}\n\n");
    response.end();
  }
}

interface RealtimeEvent {
  organizationId: string;
  workOrderId: string;
  type: string;
  occurredAt: string;
}

router.use(authenticateToken);

router.get("/events", async (req, res, next) => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    res.status(503).json({
      success: false,
      message: "Real-time updates are temporarily unavailable",
    });
    return;
  }

  const client = new Client({ connectionString });
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const close = async () => {
    if (closed) return;
    closed = true;
    openStreams.delete(res);
    if (heartbeat) clearInterval(heartbeat);
    res.off("close", onResponseClose);
    try {
      await client.end();
    } catch (error) {
      logger.warn({ error }, "Failed to close real-time database connection");
    }
  };

  const onResponseClose = () => {
    void close();
  };

  try {
    await client.connect();
    await client.query(`LISTEN ${channel}`);

    client.on("notification", (notification) => {
      if (closed || !notification.payload) return;

      let event: RealtimeEvent;
      try {
        event = JSON.parse(notification.payload) as RealtimeEvent;
      } catch (error) {
        logger.warn({ error }, "Ignoring invalid real-time notification");
        return;
      }

      if (event.organizationId !== req.auth!.organizationId) return;

      res.write(
        `event: ${event.type}\ndata: ${JSON.stringify({
          workOrderId: event.workOrderId,
          occurredAt: event.occurredAt,
        })}\n\n`,
      );
    });

    client.on("error", (error) => {
      logger.error({ error }, "Real-time database listener failed");
      if (!closed && !res.destroyed) {
        res.write("event: unavailable\ndata: {}\n\n");
        res.end();
      }
      void close();
    });

    res.status(200);
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    res.write("retry: 3000\nevent: connected\ndata: {}\n\n");
    openStreams.add(res);
    heartbeat = setInterval(() => {
      if (!res.destroyed) res.write(": heartbeat\n\n");
    }, 20_000);
    res.on("close", onResponseClose);
  } catch (error) {
    await close();
    if (!res.headersSent) next(error);
    else res.end();
  }
});

export async function publishRealtimeEvent(input: {
  organizationId: string;
  workOrderId: string;
  type: string;
}): Promise<void> {
  const event: RealtimeEvent = {
    ...input,
    occurredAt: new Date().toISOString(),
  };

  try {
    const { pool } = await import("../config/database.js");
    await pool.query("SELECT pg_notify($1, $2)", [
      channel,
      JSON.stringify(event),
    ]);
  } catch (error) {
    logger.warn(
      { error, type: input.type, workOrderId: input.workOrderId },
      "Real-time event publication failed; clients will recover by reloading persisted data",
    );
  }
}

export default router;
