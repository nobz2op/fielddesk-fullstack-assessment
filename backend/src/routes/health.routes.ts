
import { Router } from "express";
import { pool } from "../config/database.js";

const router = Router();

router.get("/", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "FieldDesk API is running",
    timestamp: new Date().toISOString(),
  });
});

router.get("/readiness", async (_req, res) => {
  try {
    const result = await pool.query("SELECT 1");

    if (result.rowCount === 1) {
      res.status(200).json({
        success: true,
        message: "FieldDesk API is ready",
        timestamp: new Date().toISOString(),
        checks: {
          database: "healthy",
        },
      });
    } else {
      res.status(503).json({
        success: false,
        message: "Database health check failed",
        timestamp: new Date().toISOString(),
        checks: {
          database: "unhealthy",
        },
      });
    }
  } catch (error) {
    res.status(503).json({
      success: false,
      message: "Database connection failed",
      timestamp: new Date().toISOString(),
      checks: {
        database: "unhealthy",
      },
    });
  }
});

export default router;