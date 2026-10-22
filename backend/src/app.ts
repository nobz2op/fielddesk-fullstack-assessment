import express, {
  type ErrorRequestHandler,
} from "express";
import cors from "cors";
import helmet from "helmet";
import healthRoutes from "./routes/health.routes.js";
import authRoutes from "./routes/auth.routes.js";
import organizationRoutes from "./routes/organization.routes.js";
import workOrderRoutes from "./routes/work-order.routes.js";

const app = express();

app.use(helmet());

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
  }),
);

app.use(express.json({ limit: "1mb" }));

app.use("/api/health", healthRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/organizations", organizationRoutes);
app.use("/api/work-orders", workOrderRoutes);

// Centralized error handler — must be registered after routes.
const errorHandler: ErrorRequestHandler = (
  err,
  _req,
  res,
  _next,
) => {
  // PostgreSQL exclusion constraint violation:
  // overlapping appointments for the same technician.
  if (err?.code === "23P01") {
    res.status(409).json({
      success: false,
      message:
        "Scheduling conflict: this technician already has an overlapping work order.",
    });
    return;
  }

  console.error("Unhandled application error:", err);

  res.status(500).json({
    success: false,
    message: "Internal server error",
  });
};

app.use(errorHandler);

export default app;
