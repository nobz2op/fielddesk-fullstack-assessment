
import { Router } from "express";
import { z } from "zod";
import { authenticateToken } from "../middleware/auth.middleware.js";
import {
  assignWorkOrder,
  createWorkOrder,
  deleteWorkOrder,
  findWorkOrderById,
  listWorkOrders,
  updateWorkOrder,
} from "../models/work-order.model.js";
import { listWorkOrderActivities } from "../models/work-order-activity.model.js";

const router = Router();

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

    const result = await listWorkOrders(
      req.auth!.organizationId,
      parsed.data,
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
    const workOrder = await findWorkOrderById(
      req.params.id,
      req.auth!.organizationId,
    );

    if (!workOrder) {
      res.status(404).json({
        success: false,
        message: "Work order not found",
      });
      return;
    }

    const activities = await listWorkOrderActivities(
      req.params.id,
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
    const workOrder = await findWorkOrderById(
      req.params.id,
      req.auth!.organizationId,
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
router.patch("/:id/assign", async (req, res, next) => {
  try {
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
      req.params.id,
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
    const parsed = updateWorkOrderSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: "Invalid work-order update",
        errors: parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
      return;
    }

    const workOrder = await updateWorkOrder(
      req.params.id,
      req.auth!.organizationId,
      parsed.data,
      req.auth!.userId,
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

// POST /api/work-orders
router.post("/", async (req, res, next) => {
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

    res.status(201).json({
      success: true,
      data: workOrder,
    });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const result = await deleteWorkOrder(
      req.params.id,
      req.auth!.organizationId,
    );

    if (!result) {
      res.status(404).json({
        success: false,
        message: "Work order not found",
      });
      return;
    }

    if ("blocked" in result && result.blocked) {
      res.status(409).json({
        success: false,
        message:
          "Cannot delete this work order because it has activity history",
      });
      return;
    }

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
