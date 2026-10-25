
import { Router } from "express";
import { z } from "zod";
import {
  authenticateToken,
  authorizeRoles,
} from "../middleware/auth.middleware.js";
import {
  assignWorkOrder,
  createWorkOrder,
  deleteWorkOrder,
  findWorkOrderById,
  listWorkOrders,
  updateWorkOrder,
  enqueueAssignmentNotification,
} from "../models/work-order.model.js";
import { listWorkOrderActivities } from "../models/work-order-activity.model.js";
import { getDashboardCounts } from "../models/dashboard.model.js";
import { publishRealtimeEvent } from "./realtime.routes.js";

const router = Router();

const workOrderIdSchema = z.string().uuid();

function validateWorkOrderId(id: string): boolean {
  return workOrderIdSchema.safeParse(id).success;
}

function getRouteParam(param: string | string[]): string {
  return Array.isArray(param) ? param[0] : param;
}

const createWorkOrderSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(5000).optional(),
  customerName: z.string().trim().min(2).max(150),
  customerEmail: z.string().trim().email().max(255).optional(),
  customerPhone: z.string().trim().max(30).optional(),
  serviceAddress: z.string().trim().min(5).max(1000),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  scheduledStart: z.string().datetime({ offset: true }).optional(),
  scheduledEnd: z.string().datetime({ offset: true }).optional(),
}).strict().refine(
  (data) =>
    !data.scheduledStart ||
    !data.scheduledEnd ||
    new Date(data.scheduledEnd) > new Date(data.scheduledStart),
  {
    message: "Scheduled end must be after scheduled start",
    path: ["scheduledEnd"],
  },
);

const updateWorkOrderSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  customerName: z.string().trim().min(2).max(150).optional(),
  customerEmail: z.string().trim().email().max(255).nullable().optional(),
  customerPhone: z.string().trim().max(30).nullable().optional(),
  serviceAddress: z.string().trim().min(5).max(1000).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  status: z.enum([
    "OPEN",
    "ASSIGNED",
    "IN_PROGRESS",
    "COMPLETED",
    "CANCELLED",
  ]).optional(),
  scheduledStart: z.string().datetime({ offset: true }).nullable().optional(),
  scheduledEnd: z.string().datetime({ offset: true }).nullable().optional(),
}).strict().refine(
  (data) => Object.keys(data).length > 0,
  { message: "At least one field must be provided" },
).refine(
  (data) =>
    !data.scheduledStart ||
    !data.scheduledEnd ||
    new Date(data.scheduledEnd) > new Date(data.scheduledStart),
  {
    message: "Scheduled end must be after scheduled start",
    path: ["scheduledEnd"],
  },
);

const technicianUpdateWorkOrderSchema = z.object({
  status: z.enum([
    "ASSIGNED",
    "IN_PROGRESS",
    "COMPLETED",
  ]),
}).strict();

const assignWorkOrderSchema = z.object({
  technicianId: z.string().uuid(),
}).strict();

const listWorkOrdersQuerySchema = z.object({
  status: z.enum([
    "OPEN",
    "ASSIGNED",
    "IN_PROGRESS",
    "COMPLETED",
    "CANCELLED",
  ]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  search: z.string().trim().max(200).optional(),
  sortBy: z.enum([
    "created_at",
    "scheduled_start",
    "priority",
    "title",
  ]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
}).strict();

router.use(authenticateToken);

// GET /api/work-orders/dashboard
router.get("/dashboard", async (req, res, next) => {
  try {
    const counts = await getDashboardCounts(
      req.auth!.organizationId,
      req.auth!.role === "TECHNICIAN"
        ? req.auth!.userId
        : undefined,
    );

    res.status(200).json({
      success: true,
      data: counts,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/work-orders
router.get("/", async (req, res, next) => {
  try {
    const parsed = listWorkOrdersQuerySchema.safeParse(req.query);

    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: "Invalid work-order query parameters",
        errors: parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
      return;
    }

    const options = {
      ...parsed.data,
      ...(req.auth!.role === "TECHNICIAN"
        ? { assignedTechnicianId: req.auth!.userId }
        : {}),
    };

    const result = await listWorkOrders(
      req.auth!.organizationId,
      options,
    );

    res.status(200).json({
      success: true,
      data: result.items,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/work-orders/:id/activities
router.get("/:id/activities", async (req, res, next) => {
  try {
    const id = getRouteParam(req.params.id);

    if (!validateWorkOrderId(id)) {
      res.status(400).json({
        success: false,
        message: "Invalid work order ID",
      });
      return;
    }

    const workOrder = await findWorkOrderById(
      id,
      req.auth!.organizationId,
      req.auth!.role === "TECHNICIAN"
        ? req.auth!.userId
        : undefined,
    );

    if (!workOrder) {
      res.status(404).json({
        success: false,
        message: "Work order not found",
      });
      return;
    }

    const activities = await listWorkOrderActivities(
      id,
      req.auth!.organizationId,
    );

    res.status(200).json({
      success: true,
      data: activities,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/work-orders/:id
router.get("/:id", async (req, res, next) => {
  try {
    const id = getRouteParam(req.params.id);

    if (!validateWorkOrderId(id)) {
      res.status(400).json({
        success: false,
        message: "Invalid work order ID",
      });
      return;
    }

    const workOrder = await findWorkOrderById(
      id,
      req.auth!.organizationId,
      req.auth!.role === "TECHNICIAN"
        ? req.auth!.userId
        : undefined,
    );

    if (!workOrder) {
      res.status(404).json({
        success: false,
        message: "Work order not found",
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: workOrder,
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/work-orders/:id/assign
router.patch(
  "/:id/assign",
  authorizeRoles("OWNER", "DISPATCHER"),
  async (req, res, next) => {
  try {
    const id = getRouteParam(req.params.id);

    if (!validateWorkOrderId(id)) {
      res.status(400).json({
        success: false,
        message: "Invalid work order ID",
      });
      return;
    }

    const parsed = assignWorkOrderSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: "Invalid technician assignment",
        errors: parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
      return;
    }

    const workOrder = await assignWorkOrder(
      id,
      req.auth!.organizationId,
      parsed.data.technicianId,
      req.auth!.userId,
    );

    if (!workOrder) {
      res.status(404).json({
        success: false,
        message:
          "Work order not found or technician is not an active technician in your organization",
      });
      return;
    }

    // Enqueue notification job (fire and forget)
    enqueueAssignmentNotification(
      id,
      req.auth!.organizationId,
      parsed.data.technicianId,
      workOrder.title,
    ).catch((error) => {
      console.error("Failed to enqueue notification:", error);
    });

    await publishRealtimeEvent({
      organizationId: req.auth!.organizationId,
      workOrderId: id,
      type: "work_order.assigned",
    });
    res.status(200).json({
      success: true,
      message: "Technician assigned successfully",
      data: workOrder,
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const id = getRouteParam(req.params.id);

    if (!validateWorkOrderId(id)) {
      res.status(400).json({
        success: false,
        message: "Invalid work order ID",
      });
      return;
    }

    const isTechnician = req.auth!.role === "TECHNICIAN";

    const parsed = isTechnician
      ? technicianUpdateWorkOrderSchema.safeParse(req.body)
      : updateWorkOrderSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: isTechnician
          ? "Technicians can update only work-order status"
          : "Invalid work-order update",
        errors: parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
      return;
    }

    // Technicians can update only work orders assigned to themselves.
    const existingWorkOrder = await findWorkOrderById(
      id,
      req.auth!.organizationId,
      isTechnician ? req.auth!.userId : undefined,
    );

    if (!existingWorkOrder) {
      res.status(404).json({
        success: false,
        message: "Work order not found",
      });
      return;
    }

    const workOrder = await updateWorkOrder(
      id,
      req.auth!.organizationId,
      parsed.data,
      req.auth!.userId,
      isTechnician ? req.auth!.userId : undefined,
    );

    if (!workOrder) {
      res.status(404).json({
        success: false,
        message: "Work order not found",
      });
      return;
    }

    await publishRealtimeEvent({
      organizationId: req.auth!.organizationId,
      workOrderId: id,
      type: "work_order.updated",
    });
    res.status(200).json({
      success: true,
      data: workOrder,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/work-orders
router.post(
  "/",
  authorizeRoles("OWNER", "DISPATCHER"),
  async (req, res, next) => {
  try {
    const parsed = createWorkOrderSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: "Invalid work-order data",
        errors: parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
      return;
    }

    const workOrder = await createWorkOrder({
      organizationId: req.auth!.organizationId,
      createdBy: req.auth!.userId,
      ...parsed.data,
    });

    await publishRealtimeEvent({
      organizationId: req.auth!.organizationId,
      workOrderId: workOrder.id,
      type: "work_order.created",
    });

    res.status(201).json({
      success: true,
      data: workOrder,
    });
  } catch (error) {
    next(error);
  }
});

router.delete(
  "/:id",
  authorizeRoles("OWNER"),
  async (req, res, next) => {
  try {
    const id = getRouteParam(req.params.id);

    if (!validateWorkOrderId(id)) {
      res.status(400).json({
        success: false,
        message: "Invalid work order ID",
      });
      return;
    }

    const result = await deleteWorkOrder(
      id,
      req.auth!.organizationId,
      req.auth!.userId,
    );

    if (!result) {
      res.status(404).json({
        success: false,
        message: "Work order not found",
      });
      return;
    }

    await publishRealtimeEvent({
      organizationId: req.auth!.organizationId,
      workOrderId: id,
      type: "work_order.deleted",
    });

    res.status(200).json({
      success: true,
      message: "Work order deleted successfully",
      data: result.deleted,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
