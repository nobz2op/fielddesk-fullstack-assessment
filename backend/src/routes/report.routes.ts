import { Router } from "express";
import { z } from "zod";
import { authenticateToken } from "../middleware/auth.middleware.js";
import { pool } from "../config/database.js";

const router = Router();

router.use(authenticateToken);

const reportQuerySchema = z.object({
  status: z.enum([
    "OPEN",
    "ASSIGNED",
    "IN_PROGRESS",
    "COMPLETED",
    "CANCELLED",
  ]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  search: z.string().trim().max(200).optional(),
}).strict();

// GET /api/reports/work-orders/csv
router.get("/work-orders/csv", async (req, res, next) => {
  try {
    const parsed = reportQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: "Invalid report query parameters",
        errors: parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
      return;
    }

    const { status, priority, search } = parsed.data;

    const conditions = ["organization_id = $1", "deleted_at IS NULL"];
    const values: unknown[] = [req.auth!.organizationId];

    if (req.auth!.role === "TECHNICIAN") {
      values.push(req.auth!.userId);
      conditions.push(`assigned_technician_id = $${values.length}`);
    }

    if (status) {
      values.push(status);
      conditions.push(`status = $${values.length}`);
    }

    if (priority) {
      values.push(priority);
      conditions.push(`priority = $${values.length}`);
    }

    if (search) {
      values.push(`%${search}%`);
      conditions.push(
        `(title ILIKE $${values.length} OR customer_name ILIKE $${values.length})`,
      );
    }

    const whereClause = conditions.join(" AND ");

    const query = `
      SELECT
        id,
        title,
        description,
        customer_name,
        customer_email,
        customer_phone,
        service_address,
        priority,
        status,
        assigned_technician_id,
        scheduled_start,
        scheduled_end,
        created_at,
        created_at::text AS created_at_cursor,
        updated_at
      FROM work_orders
      WHERE ${whereClause}
      ORDER BY created_at DESC, id ASC
      LIMIT $${values.length + 1}
    `;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="work-orders-${Date.now()}.csv"`,
    );

    // CSV header row
    const headers = [
      "ID",
      "Title",
      "Description",
      "Customer Name",
      "Customer Email",
      "Customer Phone",
      "Service Address",
      "Priority",
      "Status",
      "Assigned Technician ID",
      "Scheduled Start",
      "Scheduled End",
      "Created At",
      "Updated At",
    ];

    // Function to escape CSV values to prevent formula injection
    const escapeCsv = (value: string | null | undefined): string => {
      if (value === null || value === undefined) return "";
      const raw = String(value);
      const safe = /^[\u0000-\u0020]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]/.test(raw)
        ? `'${raw}`
        : raw;
      return `"${safe.replace(/"/g, '""')}"`;
    };

    res.status(200);
    res.write(headers.map(escapeCsv).join(",") + "\n");

    const batchSize = 500;
    let lastCreatedAt: string | null = null;
    let lastId: string | null = null;

    while (!res.destroyed) {
      const batchValues: unknown[] = [...values, batchSize];
      let batchQuery = query;

      if (lastCreatedAt && lastId) {
        const cursorIndex = values.length + 1;
        batchValues.splice(values.length, 1);
        batchValues.push(lastCreatedAt, lastId, batchSize);
        batchQuery = `
          SELECT
            id,
            title,
            description,
            customer_name,
            customer_email,
            customer_phone,
            service_address,
            priority,
            status,
            assigned_technician_id,
            scheduled_start,
            scheduled_end,
            created_at,
            created_at::text AS created_at_cursor,
            updated_at
          FROM work_orders
          WHERE ${whereClause}
            AND (
              created_at < $${cursorIndex}
              OR (created_at = $${cursorIndex} AND id > $${cursorIndex + 1})
            )
          ORDER BY created_at DESC, id ASC
          LIMIT $${cursorIndex + 2}
        `;
      }

      const result = await pool.query(batchQuery, batchValues);
      if (result.rows.length === 0) break;

      for (const row of result.rows) {
        const rowValues = [
          row.id,
          row.title,
          row.description,
          row.customer_name,
          row.customer_email,
          row.customer_phone,
          row.service_address,
          row.priority,
          row.status,
          row.assigned_technician_id,
          row.scheduled_start,
          row.scheduled_end,
          row.created_at,
          row.updated_at,
        ];

        if (!res.write(rowValues.map(escapeCsv).join(",") + "\n")) {
          await new Promise<void>((resolve) => {
            const done = () => {
              res.off("drain", done);
              res.off("close", done);
              resolve();
            };
            res.once("drain", done);
            res.once("close", done);
          });
        }
      }

      const lastRow = result.rows[result.rows.length - 1];
      lastCreatedAt = lastRow.created_at_cursor;
      lastId = lastRow.id;
      if (result.rows.length < batchSize) break;
    }

    res.end();
  } catch (error) {
    if (res.headersSent) {
      res.destroy(error instanceof Error ? error : undefined);
      return;
    }
    next(error);
  }
});

export default router;
