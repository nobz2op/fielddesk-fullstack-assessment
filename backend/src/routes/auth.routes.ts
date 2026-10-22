import { Router } from "express";
import bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import jwt from "jsonwebtoken";
import { pool } from "../config/database.js";
import { authenticateToken, authorizeRoles } from "../middleware/auth.middleware.js";

const router = Router();

const registrationSchema = z.object({
  name: z.string().trim().min(2).max(150),
  email: z.string().trim().email().max(255),
  password: z
    .string()
    .min(8)
    .refine(
      (password) => Buffer.byteLength(password, "utf8") <= 72,
      "Password must not exceed 72 bytes",
    ),
  organizationName: z.string().trim().min(2).max(150),
});

router.post("/register", async (req, res) => {
  const validation = registrationSchema.safeParse(req.body);

  if (!validation.success) {
    return res.status(400).json({
      success: false,
      message: "Invalid registration details",
      errors: validation.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const { name, password, organizationName } = validation.data;
  const email = validation.data.email.toLowerCase();

  let client;

  try {
    client = await pool.connect();

    // Hash the password before storing it.
    const passwordHash = await bcrypt.hash(password, 12);

    const organizationId = randomUUID();
    const userId = randomUUID();

    // Create the organization and owner atomically.
    await client.query("BEGIN");

    const organizationResult = await client.query(
      `INSERT INTO organizations (id, name)
       VALUES ($1, $2)
       RETURNING id, name`,
      [organizationId, organizationName],
    );

    await client.query(
      `INSERT INTO users
         (id, organization_id, name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        userId,
        organizationId,
        name,
        email,
        passwordHash,
        "OWNER",
      ],
    );

    await client.query("COMMIT");

    return res.status(201).json({
      success: true,
      message: "Registration successful",
      organization: organizationResult.rows[0],
      user: {
        id: userId,
        organization_id: organizationId,
        name,
        email,
        role: "OWNER",
      },
    });
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Registration rollback failed:", rollbackError);
      }
    }

    // PostgreSQL unique-constraint violation.
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists in this organization",
      });
    }

    console.error("Registration failed:", error);

    return res.status(500).json({
      success: false,
      message: "Registration failed. Please try again.",
    });
  } finally {
    client?.release();
  }
});

const loginSchema = z.object({
  organizationId: z.string().uuid(),
  email: z.string().trim().email().max(255),
  password: z.string().min(1).max(72),
});

router.post("/login", async (req, res) => {
  const validation = loginSchema.safeParse(req.body);

  if (!validation.success) {
    return res.status(400).json({
      success: false,
      message: "Invalid login details",
    });
  }

  const { organizationId, password } = validation.data;
  const email = validation.data.email.toLowerCase();

  try {
    const result = await pool.query(
      `SELECT id, organization_id, name, email,
              password_hash, role, is_active
       FROM users
       WHERE organization_id = $1 AND email = $2
       LIMIT 1`,
      [organizationId, email],
    );

    const user = result.rows[0];

    // Use the same response for an unknown user and a wrong password.
    if (!user || !user.is_active) {
      return res.status(401).json({
        success: false,
        message: "Invalid email, password, or organization",
      });
    }

    const passwordMatches = await bcrypt.compare(
      password,
      user.password_hash,
    );

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message: "Invalid email, password, or organization",
      });
    }

    const secret = process.env.JWT_SECRET;

    if (!secret || secret.length < 64) {
      console.error("JWT_SECRET is missing or too short");
      return res.status(500).json({
        success: false,
        message: "Authentication is not configured",
      });
    }

    const token = jwt.sign(
      {
        organizationId: user.organization_id,
        role: user.role,
      },
      secret,
      {
        subject: user.id,
        expiresIn: "1h",
        issuer: "fielddesk-api",
        audience: "fielddesk-client",
      },
    );

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user.id,
        organization_id: user.organization_id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Login failed:", error);

    return res.status(500).json({
      success: false,
      message: "Login failed. Please try again.",
    });
  }
});

router.get("/me", authenticateToken, (req, res) => {
  return res.status(200).json({
    success: true,
    user: req.auth,
  });
});

router.get(
  "/owner-only",
  authenticateToken,
  authorizeRoles("OWNER"),
  (_req, res) => {
    res.status(200).json({
      success: true,
      message: "Owner access granted",
    });
  },
);

export default router;
