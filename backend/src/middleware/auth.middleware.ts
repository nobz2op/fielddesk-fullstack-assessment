import type { Request, Response, NextFunction } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";

export type UserRole = "OWNER" | "DISPATCHER" | "TECHNICIAN";

export interface AuthenticatedUser {
  userId: string;
  organizationId: string;
  role: UserRole;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthenticatedUser;
    }
  }
}

const allowedRoles: UserRole[] = [
  "OWNER",
  "DISPATCHER",
  "TECHNICIAN",
];

export function authenticateToken(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const authorization = req.headers.authorization;

  if (!authorization?.startsWith("Bearer ")) {
    res.status(401).json({
      success: false,
      message: "Authentication required",
    });
    return;
  }

  const token = authorization.slice("Bearer ".length);
  const secret = process.env.JWT_SECRET;

  if (!secret || secret.length < 64) {
    res.status(500).json({
      success: false,
      message: "Authentication is not configured",
    });
    return;
  }

  try {
    const decoded = jwt.verify(token, secret, {
      issuer: "fielddesk-api",
      audience: "fielddesk-client",
    });

    if (typeof decoded === "string") {
      res.status(401).json({
        success: false,
        message: "Invalid or expired token",
      });
      return;
    }

    const payload = decoded as JwtPayload;
    const role = payload.role;

    if (
      typeof payload.sub !== "string" ||
      typeof payload.organizationId !== "string" ||
      typeof role !== "string" ||
      !allowedRoles.includes(role as UserRole)
    ) {
      res.status(401).json({
        success: false,
        message: "Invalid or expired token",
      });
      return;
    }

    req.auth = {
      userId: payload.sub,
      organizationId: payload.organizationId,
      role: role as UserRole,
    };

    next();
  } catch {
    res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
}

export function authorizeRoles(...roles: UserRole[]) {
  return (
    req: Request,
    res: Response,
    next: NextFunction,
  ): void => {
    if (!req.auth) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    if (!roles.includes(req.auth.role)) {
      res.status(403).json({
        success: false,
        message: "You do not have permission to perform this action",
      });
      return;
    }

    next();
  };
}
