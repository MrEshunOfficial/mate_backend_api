// controllers/profiles/provider/base.handlers.ts
import { Response } from "express";
import { ProviderProfileService } from "../../../../service/profiles/provider.profile.service";
import { AuthenticatedRequest } from "../../../../types/user.types";

// ─── Shared Service Instance ──────────────────────────────────────────────────

/**
 * Single ProviderProfileService instance shared across all handler modules.
 * All handler files import this — avoids constructing multiple instances and
 * keeps LocationService injection consistent.
 */
export const providerProfileService = new ProviderProfileService();

// ─── Pagination ───────────────────────────────────────────────────────────────

export interface PaginationParams {
  limit: number;
  skip: number;
}

/**
 * Parses and bounds limit/skip query params.
 * Defaults: limit=20, skip=0. Hard cap: limit=100.
 */
export const parsePagination = (
  query: AuthenticatedRequest["query"]
): PaginationParams => ({
  limit: Math.min(Math.max(parseInt(query.limit as string) || 20, 1), 100),
  skip: Math.max(parseInt(query.skip as string) || 0, 0),
});

// ─── Response Builders ────────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
}

export const sendSuccess = <T>(
  res: Response,
  message: string,
  data?: T,
  status = 200
): void => {
  res.status(status).json({ success: true, message, ...(data !== undefined && { data }) });
};

export const sendError = (
  res: Response,
  status: number,
  message: string,
  error?: string
): void => {
  res.status(status).json({ success: false, message, ...(error && { error }) });
};

// ─── Standard Error Handler ───────────────────────────────────────────────────

/**
 * Maps well-known service-layer error messages to HTTP status codes.
 * Anything not explicitly mapped falls through to 500.
 *
 * Convention used by every service: validation errors are plain `new Error(…)`
 * with descriptive messages; not-found errors end with "not found".
 */
export const handleServiceError = (res: Response, error: unknown): void => {
  if (!(error instanceof Error)) {
    sendError(res, 500, "Internal server error", String(error));
    return;
  }

  const msg = error.message.toLowerCase();

  // 400 — validation / bad input
  const is400 =
    msg.includes("required") ||
    msg.includes("invalid") ||
    msg.includes("must be") ||
    msg.includes("cannot be empty") ||
    msg.includes("already exists") ||
    msg.includes("duplicate") ||
    msg.includes("must have") ||
    msg.includes("format must") ||
    msg.includes("between") ||
    msg.includes("cannot approve") ||
    msg.includes("does not belong");

  // 404 — resource not found
  const is404 =
    msg.includes("not found") ||
    msg.includes("no active profile");

  // 403 — forbidden / ownership
  const is403 = msg.includes("permission") || msg.includes("access denied");

  const statusCode = is404 ? 404 : is403 ? 403 : is400 ? 400 : 500;
  sendError(res, statusCode, error.message, error.message);
};

// ─── Ownership Resolution ─────────────────────────────────────────────────────

/**
 * Returns whether the caller is operating on their own profile OR holds an
 * elevated system role. Used by handlers that allow both owner and admin access.
 *
 * Compares the ProviderProfile._id from the route param against the profiles
 * that belong to the authenticated user — done via service layer to avoid
 * direct model imports in handler files.
 */
export const isOwnerOrAdmin = async (
  req: AuthenticatedRequest,
  profileId: string
): Promise<boolean> => {
  const userSystemRole = req.user?.systemRole;
  const isAdmin =
    userSystemRole === "admin" || userSystemRole === "super_admin";
  if (isAdmin) return true;

  // The requireProviderOwnership middleware already runs on write routes —
  // this helper exists for read routes that serve richer data to the owner
  // than to the public.
  const userProfileId = (req as any).userProfileId as string | undefined;
  if (!userProfileId) return false;

  try {
    const profile =
      await providerProfileService.getProviderProfileByProfileRef(userProfileId);
    return profile?._id?.toString() === profileId;
  } catch {
    return false;
  }
};