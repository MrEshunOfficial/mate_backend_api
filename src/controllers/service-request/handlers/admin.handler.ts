import { Response } from "express";
import { ServiceRequestStatus } from "../../../types/service-request.types";
import {
  handleError,
  validateObjectId,
  AuthenticatedRequest,
} from "../../../utils/auth/auth.controller.utils";
import { serviceRequestService } from "../../../service/services/service-request.service";

export class ServiceRequestAdminHandler {

  /**
   * GET /admin/service-requests
   *
   * Returns a paginated list of all service requests across the platform.
   * Admin only.
   *
   * Query params:
   *   - status         (optional) — filter by ServiceRequestStatus
   *   - clientId       (optional) — filter by client ObjectId
   *   - providerId     (optional) — filter by provider ObjectId
   *   - includeDeleted (optional, default "false") — include soft-deleted records
   *   - limit          (optional, default 20)
   *   - skip           (optional, default 0)
   */
  getAllServiceRequests = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const status         = req.query.status         as ServiceRequestStatus | undefined;
      const clientId       = req.query.clientId       as string | undefined;
      const providerId     = req.query.providerId     as string | undefined;
      const includeDeleted = req.query.includeDeleted === "true";
      const limit          = parseInt(String(req.query.limit ?? "20"), 10);
      const skip           = parseInt(String(req.query.skip  ?? "0"),  10);

      // Validate status if provided
      if (status && !Object.values(ServiceRequestStatus).includes(status)) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: `Invalid status. Must be one of: ${Object.values(ServiceRequestStatus).join(", ")}`,
        });
        return;
      }

      // Validate IDs if provided
      if (clientId && !validateObjectId(clientId)) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: "clientId must be a valid ObjectId",
        });
        return;
      }
      if (providerId && !validateObjectId(providerId)) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: "providerId must be a valid ObjectId",
        });
        return;
      }

      const result = await serviceRequestService.getAllServiceRequests(
        {
          limit: isNaN(limit) ? 20 : Math.min(100, Math.max(1, limit)),
          skip:  isNaN(skip)  ? 0  : Math.max(0, skip),
        },
        {
          status,
          clientId,
          providerId,
          includeDeleted,
        },
      );

      res.status(200).json({
        success: true,
        message: `Retrieved ${result.requests.length} service request(s)`,
        ...result,
      });
    } catch (error) {
      handleError(res, error, "Failed to retrieve all service requests");
    }
  };

  /**
   * GET /admin/service-requests/stats
   *
   * Returns platform-wide or per-actor service request statistics.
   * Admin only.
   *
   * Query params:
   *   - actorId   (optional) — scope stats to a specific actor
   *   - actorRole (optional, "client" | "provider") — must accompany actorId
   *
   * Metrics returned:
   *   - total, pending, accepted, rejected, expired, cancelled, deleted
   *   - acceptanceRate   — ACCEPTED / (ACCEPTED + REJECTED) × 100
   *   - conversionRate   — ACCEPTED with linked booking / ACCEPTED × 100
   *   - expiryRate       — EXPIRED / total × 100
   *   - averageResponseMs — mean provider response time in milliseconds
   */
  getServiceRequestStats = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const actorId   = req.query.actorId   as string | undefined;
      const actorRole = req.query.actorRole as "client" | "provider" | undefined;

      if (actorId && !validateObjectId(actorId)) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: "actorId must be a valid ObjectId",
        });
        return;
      }

      if (actorRole && !["client", "provider"].includes(actorRole)) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: "actorRole must be 'client' or 'provider'",
        });
        return;
      }

      if (actorId && !actorRole) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: "actorRole is required when actorId is provided",
        });
        return;
      }

      const stats = await serviceRequestService.getServiceRequestStats({
        actorId,
        actorRole,
      });

      res.status(200).json({
        success: true,
        message: "Service request statistics retrieved successfully",
        stats,
      });
    } catch (error) {
      handleError(res, error, "Failed to retrieve service request statistics");
    }
  };

  /**
   * POST /admin/service-requests/expire
   *
   * Batch-expires all PENDING service requests whose expiresAt has passed.
   * Intended to be called by a scheduled cron job (e.g. every 30 minutes).
   * Admin only — also callable via internal cron with service-account auth.
   *
   * Returns the count of requests transitioned to EXPIRED.
   */
  expireOverdueServiceRequests = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const expiredCount = await serviceRequestService.expireOverdueServiceRequests();

      res.status(200).json({
        success: true,
        message:
          expiredCount > 0
            ? `Successfully expired ${expiredCount} overdue service request(s)`
            : "No overdue service requests found",
        expiredCount,
      });
    } catch (error) {
      handleError(res, error, "Failed to expire overdue service requests");
    }
  };
}