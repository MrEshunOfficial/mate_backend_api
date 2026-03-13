import { Types } from "mongoose";
import { SystemRole} from "../../types/base.types";
import { Response } from "express";

// ─── Validation ───────────────────────────────────────────────────────────────
export const validateObjectId = (id: string): boolean =>
  Types.ObjectId.isValid(id);

// ─── Super Admin Helpers ──────────────────────────────────────────────────────

export const isSuperAdminEmail = (email: string): boolean => {
  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL;
  if (!superAdminEmail) {
    console.warn("SUPER_ADMIN_EMAIL environment variable is not set");
    return false;
  }
  return email.toLowerCase() === superAdminEmail.toLowerCase();
};

// Sets the minimum fields required to elevate a user document to SUPER_ADMIN.
// isAdmin / isSuperAdmin no longer exist on IUser — systemRole is the single
// source of truth. The model pre-save hook derives everything from it.
export const applySuperAdminProperties = (userDoc: any): void => {
  userDoc.systemRole = SystemRole.SUPER_ADMIN;
  userDoc.systemAdminName =
    process.env.SUPER_ADMIN_NAME ?? "System Administrator";
  userDoc.isEmailVerified = true;
};

// Re-export request shapes so handlers can import from one place
export type { AuthenticatedRequest, VerifiedRequest } from "../../types/user.types";

// ─── Error / Success Helpers ──────────────────────────────────────────────────

export const handleError = (
  res: Response,
  error: unknown,
  message = "Internal server error"
) => {
  console.error(error);
  return res.status(500).json({
    success: false,
    message,
    error: error instanceof Error ? error.message : String(error),
  });
};



// ─── Param Extraction ─────────────────────────────────────────────────────────

/**
 * Safely extracts a single string value from an Express route param.
 *
 * Express types req.params values as string | string[], but route params
 * are always a single string in practice. This util makes that explicit
 * and provides a single place to update if the behaviour ever changes.
 *
 * Usage:
 *   const id = getParam(req.params.id);       // route param
 *   const slug = getParam(req.params.slug);   // route param
 */
export const getParam = (param: string | string[]): string =>
  Array.isArray(param) ? param[0] : param;