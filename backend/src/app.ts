import express, {
  type ErrorRequestHandler,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import helmet from "helmet";
import pino from "pino";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";
import healthRoutes from "./routes/health.routes.js";
import authRoutes from "./routes/auth.routes.js";
import organizationRoutes from "./routes/organization.routes.js";
import workOrderRoutes from "./routes/work-order.routes.js";
import progressEventRoutes from "./routes/progress-event.routes.js";
import attachmentRoutes from "./routes/attachment.routes.js";
import reportRoutes from "./routes/report.routes.js";
import realtimeRoutes from "./routes/realtime.routes.js";

declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  base: {
    service: "fielddesk-api",
  },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers['x-api-key']",
      "res.headers['set-cookie']",
    ],
    censor: "[REDACTED]",
  },
});

const app = express();

app.use(helmet());

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
  }),
);

app.use(express.json({ limit: "1mb" }));

// Request correlation ID middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  req.id = req.headers["x-request-id"] as string || crypto.randomUUID();
  res.setHeader("x-request-id", req.id);
  next();
});

// Structured logging middleware
app.use(
  pinoHttp({
    logger,
    genReqId: (req) => req.id as string,
    customLogLevel: (res, err) => {
      const statusCode = res.statusCode || 500;
      if (statusCode >= 500) return "error";
      if (statusCode >= 400) return "warn";
      return "info";
    },
  }),
);

// Rate limiting for authentication endpoints
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 requests per window
  message: {
    success: false,
    message: "Too many authentication attempts, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/health", healthRoutes);
app.use("/api/auth", authRateLimit, authRoutes);
app.use("/api/organizations", organizationRoutes);
app.use("/api/work-orders", workOrderRoutes);
app.use("/api/progress-events", progressEventRoutes);
app.use("/api/attachments", attachmentRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/realtime", realtimeRoutes);

// Centralized error handler — must be registered after routes.
const errorHandler: ErrorRequestHandler = (
  err,
  req,
  res,
  _next,
) => {
  // PostgreSQL exclusion constraint violation:
  // overlapping appointments for the same technician.
  if (err?.code === "23P01") {
    logger.warn(
      { reqId: req.id, error: err },
      "Scheduling conflict detected",
    );
    res.status(409).json({
      success: false,
      message:
        "Scheduling conflict: this technician already has an overlapping work order.",
    });
    return;
  }

  logger.error(
    { reqId: req.id, error: err },
    "Unhandled application error",
  );

  res.status(500).json({
    success: false,
    message: "Internal server error",
  });
};

app.use(errorHandler);

export default app;
