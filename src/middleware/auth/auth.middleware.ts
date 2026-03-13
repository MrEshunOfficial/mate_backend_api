import { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AuthenticatedRequest } from "../../types/user.types";
import { TokenPayload } from "../../utils/auth/generateTokenAndSetCookies";
import { User } from "../../models/auth/auth.model";
import { SystemRole } from "../../types/base.types";

// ─── Token Authentication ─────────────────────────────────────────────────────

export const authenticateToken = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Accept token from cookie or Authorization header
    const token: string | undefined =
      req.cookies?.token ??
      (req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.split(" ")[1]
        : undefined);

    if (!token) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
        error: "No token provided",
      });
      return;
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET as string
    ) as TokenPayload;

    // Always re-fetch from DB so revoked / deleted accounts are caught
    const user = await User.findById(decoded.userId);

    if (!user) {
      res.status(401).json({
        success: false,
        message: "User not found",
        error: "The account associated with this token no longer exists",
      });
      return;
    }

    req.userId = decoded.userId;
    req.user = user;

    next();
  } catch (error) {
    const message =
      error instanceof jwt.TokenExpiredError
        ? "Token has expired"
        : "Invalid token";

    res.status(401).json({ success: false, message, error: message });
  }
};

// ─── Email Verification Guard ─────────────────────────────────────────────────

export const requireVerification = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user?.isEmailVerified) {
    res.status(403).json({
      success: false,
      message: "Email verification required",
      error: "Please verify your email address before accessing this resource",
    });
    return;
  }
  next();
};

// ─── Role Guards ──────────────────────────────────────────────────────────────

// Allows both ADMIN and SUPER_ADMIN. isAdmin / isSuperAdmin are removed from
// IUser — systemRole is the single source of truth (see user.types.ts).
export const requireAdmin = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  const role = req.user?.systemRole;
  const hasAccess =
    role === SystemRole.ADMIN || role === SystemRole.SUPER_ADMIN;

  if (!hasAccess) {
    res.status(403).json({
      success: false,
      message: "Admin access required",
      error: "This action requires admin or super admin privileges",
    });
    return;
  }
  next();
};

// Allows SUPER_ADMIN only.
export const requireSuperAdmin = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  if (req.user?.systemRole !== SystemRole.SUPER_ADMIN) {
    res.status(403).json({
      success: false,
      message: "Super admin access required",
      error: "This action requires super admin privileges",
    });
    return;
  }
  next();
};