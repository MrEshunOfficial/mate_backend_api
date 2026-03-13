// controllers/profiles/client/base.handlers.ts
import { Response } from "express";
import { ClientProfileService } from "../../../../service/profiles/client.profile.service";
import { AuthenticatedRequest } from "../../../../utils/auth/auth.controller.utils";

// ─── Shared Service Instance ──────────────────────────────────────────────────

/**
 * Single ClientProfileService instance shared across all handler modules.
 * All handler files import this — avoids constructing multiple instances and
 * keeps LocationService injection consistent.
 */
export const clientProfileService = new ClientProfileService();

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

export const sendSuccess = <T>(
  res: Response,
  message: string,
  data?: T,
  status = 200
): void => {
  res.status(status).json({
    success: true,
    message,
    ...(data !== undefined && { data }),
  });
};

export const sendError = (
  res: Response,
  status: number,
  message: string,
  error?: string
): void => {
  res.status(status).json({
    success: false,
    message,
    ...(error && { error }),
  });
};

// ─── Standard Error Handler ───────────────────────────────────────────────────

/**
 * Maps well-known service-layer error messages to HTTP status codes.
 * Convention used by every service: validation errors are plain `new Error(…)`
 * with descriptive messages; not-found errors end with "not found".
 */
export const handleServiceError = (res: Response, error: unknown): void => {
  if (!(error instanceof Error)) {
    sendError(res, 500, "Internal server error", String(error));
    return;
  }

  const msg = error.message.toLowerCase();

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
    msg.includes("cannot be") ||
    msg.includes("payload cannot");

  const is404 =
    msg.includes("not found") ||
    msg.includes("no active profile");

  const is403 =
    msg.includes("permission") ||
    msg.includes("access denied");

  const statusCode = is404 ? 404 : is403 ? 403 : is400 ? 400 : 500;
  sendError(res, statusCode, error.message, error.message);
};