import { Router } from "express";
import { pool } from "../config/database.js";
import { authenticateToken } from "../middleware/auth.middleware.js";

const router = Router();

router.get("/me", authenticateToken, async (req, res) => {
  const organizationId = req.auth!.organizationId;

  try {
    const result = await pool.query(
      `SELECT id, name, created_at, updated_at
       FROM organizations
       WHERE id = $1
       LIMIT 1`,
      [organizationId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Organization not found",
      });
    }

    return res.status(200).json({
      success: true,
      organization: result.rows[0],
    });
  } catch (error) {
    console.error("Failed to retrieve organization:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve organization",
    });
  }
});

export default router;
