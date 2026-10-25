import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { authenticateToken } from "../middleware/auth.middleware.js";
import {
  createAttachment,
  getAttachmentById,
  listAttachmentsByWorkOrder,
  getOrganizationStorageUsage,
  validateFileType,
  validateFileSize,
  detectAttachmentFileType,
  generateStorageIdentifier,
} from "../models/attachment.model.js";
import { findWorkOrderById } from "../models/work-order.model.js";
import { publishRealtimeEvent } from "./realtime.routes.js";

const router = Router();

function getRouteParam(param: string | string[]): string {
  return Array.isArray(param) ? param[0] : param;
}

// Configure storage
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), "uploads");
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error as Error, uploadDir);
    }
  },
  filename: (req, file, cb) => {
    const identifier = generateStorageIdentifier();
    cb(null, identifier);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    if (!validateFileType(file.mimetype)) {
      cb(new Error("Invalid file type. Only images (JPEG, PNG, GIF, WebP) and PDF are allowed."));
      return;
    }
    cb(null, true);
  },
});

router.use(authenticateToken);

async function authorizeWorkOrderAccess(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
): Promise<void> {
  try {
    const workOrderId = getRouteParam(req.params.workOrderId);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workOrderId)) {
      res.status(400).json({
        success: false,
        message: "Invalid work order ID",
      });
      return;
    }

    const workOrder = await findWorkOrderById(
      workOrderId,
      req.auth!.organizationId,
      req.auth!.role === "TECHNICIAN" ? req.auth!.userId : undefined,
    );
    if (!workOrder) {
      res.status(404).json({
        success: false,
        message: "Work order not found",
      });
      return;
    }

    next();
  } catch (error) {
    next(error);
  }
}

// GET /api/attachments/work-order/:workOrderId
router.get("/work-order/:workOrderId", async (req, res, next) => {
  try {
    const workOrderId = getRouteParam(req.params.workOrderId);

    const workOrder = await findWorkOrderById(
      workOrderId,
      req.auth!.organizationId,
      req.auth!.role === "TECHNICIAN" ? req.auth!.userId : undefined,
    );

    if (!workOrder) {
      res.status(404).json({
        success: false,
        message: "Work order not found",
      });
      return;
    }

    const attachments = await listAttachmentsByWorkOrder(
      workOrderId,
      req.auth!.organizationId,
    );

    res.status(200).json({
      success: true,
      data: attachments,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/attachments/storage-usage
router.get("/storage-usage", async (req, res, next) => {
  try {
    const usage = await getOrganizationStorageUsage(req.auth!.organizationId);

    res.status(200).json({
      success: true,
      data: usage,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/attachments/work-order/:workOrderId
router.post(
  "/work-order/:workOrderId",
  authorizeWorkOrderAccess,
  (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err) {
        // Handle multer errors
        if (err.code === "LIMIT_FILE_SIZE") {
          res.status(400).json({
            success: false,
            message: "File size exceeds the 10MB limit",
          });
          return;
        }
        if (err.message && err.message.includes("Invalid file type")) {
          res.status(400).json({
            success: false,
            message: err.message,
          });
          return;
        }
        return next(err);
      }
      next();
    });
  },
  async (req, res, next) => {
    try {
      if (!req.file) {
        res.status(400).json({
          success: false,
          message: "No file uploaded",
        });
        return;
      }

      const workOrderId = getRouteParam(req.params.workOrderId);
      const fileType = req.file.mimetype;
      if (!validateFileType(fileType) || !validateFileSize(req.file.size)) {
        await fs.unlink(req.file.path);
        res.status(400).json({
          success: false,
          message: "Invalid file type or size",
        });
        return;
      }

      const signatureType = detectAttachmentFileType(
        await fs.readFile(req.file.path),
      );
      if (signatureType !== fileType) {
        await fs.unlink(req.file.path);
        res.status(400).json({
          success: false,
          message: "File content does not match its declared type",
        });
        return;
      }

      const originalFilename = path
        .basename(req.file.originalname.replace(/[\\/]/g, "/"))
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .slice(0, 255) || "attachment";

      const result = await createAttachment({
        organizationId: req.auth!.organizationId,
        workOrderId,
        uploadedBy: req.auth!.userId,
        storageIdentifier: req.file.filename,
        originalFilename,
        fileType,
        fileSize: req.file.size,
      });

      if ("notFound" in result) {
        await fs.unlink(req.file.path);
        res.status(404).json({
          success: false,
          message: "Work order not found",
        });
        return;
      }

      if ("quotaExceeded" in result) {
        await fs.unlink(req.file.path);
        res.status(409).json({
          success: false,
          message: "Organization storage quota exceeded",
          currentUsage: result.currentUsage,
          quota: result.quota,
        });
        return;
      }

      await publishRealtimeEvent({
        organizationId: req.auth!.organizationId,
        workOrderId,
        type: "attachment.created",
      });

      res.status(201).json({
        success: true,
        message: "Attachment uploaded successfully",
        data: result.attachment,
      });
    } catch (error) {
      // Clean up the uploaded file on error
      if (req.file) {
        try {
          await fs.unlink(req.file.path);
        } catch (cleanupError) {
          if (!(cleanupError instanceof Error) || !("code" in cleanupError) || cleanupError.code !== "ENOENT") {
            next(cleanupError);
            return;
          }
        }
      }
      next(error);
    }
  },
);

// GET /api/attachments/:id/download
router.get("/:id/download", async (req, res, next) => {
  try {
    const attachment = await getAttachmentById(
      req.params.id,
      req.auth!.organizationId,
    );

    if (!attachment) {
      res.status(404).json({
        success: false,
        message: "Attachment not found",
      });
      return;
    }

    if (req.auth!.role === "TECHNICIAN") {
      const workOrder = await findWorkOrderById(
        attachment.work_order_id,
        req.auth!.organizationId,
        req.auth!.userId,
      );
      if (!workOrder) {
        res.status(404).json({
          success: false,
          message: "Attachment not found",
        });
        return;
      }
    }

    const uploadDir = path.resolve(process.cwd(), "uploads");
    const filePath = path.resolve(uploadDir, attachment.storage_identifier);
    if (path.dirname(filePath) !== uploadDir) {
      res.status(404).json({
        success: false,
        message: "File not found on disk",
      });
      return;
    }

    try {
      await fs.access(filePath);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
        next(error);
        return;
      }
      res.status(404).json({
        success: false,
        message: "File not found on disk",
      });
      return;
    }

    res.type(attachment.file_type);
    res.attachment(attachment.original_filename);
    res.sendFile(filePath, (error) => {
      if (error) next(error);
    });
  } catch (error) {
    next(error);
  }
});

export default router;
