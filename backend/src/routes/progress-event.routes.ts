import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { authenticateToken, authorizeRoles } from "../middleware/auth.middleware.js";
import { createProgressEvent } from "../models/progress-event.model.js";
import { publishRealtimeEvent } from "./realtime.routes.js";

function getRouteParam(param: string | string[]): string {
  return Array.isArray(param) ? param[0] : param;
}

const router = Router();

const eventRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 events per minute
  message: {
    success: false,
    message: "Too many event submissions, please slow down.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const progressEventSchema = z.object({
  eventId: z.string().trim().min(1).max(100),
  workOrderId: z.string().uuid(),
  type: z.enum(["status_changed", "note_added", "location_updated", "custom"]),
  occurredAt: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()).refine(
    (data) => typeof data === "object" && data !== null,
    { message: "Payload must be an object" },
  ),
}).strict().refine(
  (data) => {
    if (data.type === "status_changed") {
      return "status" in data.payload && typeof data.payload.status === "string";
    }
    if (data.type === "note_added") {
      return "note" in data.payload && typeof data.payload.note === "string";
    }
    if (data.type === "location_updated") {
      return "location" in data.payload && typeof data.payload.location === "string";
    }
    return true;
  },
  {
    message: "Payload missing required field for event type",
  },
);

router.use(authenticateToken);
router.use(eventRateLimit);

// POST /api/progress-events
router.post("/", authorizeRoles("TECHNICIAN"), async (req, res, next) => {
  try {
    const parsed = progressEventSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: "Invalid progress event data",
        errors: parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
      return;
    }

    const result = await createProgressEvent({
      eventId: parsed.data.eventId,
      organizationId: req.auth!.organizationId,
      workOrderId: parsed.data.workOrderId,
      submittedBy: req.auth!.userId,
      type: parsed.data.type,
      occurredAt: parsed.data.occurredAt,
      payload: parsed.data.payload,
    });

    if ("notFound" in result) {
      res.status(404).json({
        success: false,
        message: "Work order not found",
      });
      return;
    }

    if ("notAssigned" in result) {
      res.status(400).json({
        success: false,
        message: "Work order is not assigned to a technician",
      });
      return;
    }

    if ("unauthorized" in result) {
      res.status(403).json({
        success: false,
        message: "You are not assigned to this work order",
      });
      return;
    }

    if ("invalidPayload" in result) {
      res.status(400).json({
        success: false,
        message: result.message || "Invalid event payload",
      });
      return;
    }

    if ("duplicate" in result) {
      res.status(409).json({
        success: false,
        message: "Event ID already processed for this work order",
        event: result.event,
      });
      return;
    }

    await publishRealtimeEvent({
      organizationId: req.auth!.organizationId,
      workOrderId: parsed.data.workOrderId,
      type: "progress_event.created",
    });

    res.status(201).json({
      success: true,
      message: "Progress event recorded successfully",
      data: result.event,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
