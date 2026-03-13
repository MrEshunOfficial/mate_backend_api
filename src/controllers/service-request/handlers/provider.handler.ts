import { Response } from "express";
import { ServiceRequestStatus } from "../../../types/service-request.types";
import {
  handleError,
  validateObjectId,
  AuthenticatedRequest,
  getParam,
} from "../../../utils/auth/auth.controller.utils";
import ProviderProfileModel from "../../../models/profiles/provider.profile.model";
import { Types } from "mongoose";
import { getUserProfileId } from "../../../middleware/role/role.middleware";
import { serviceRequestService } from "../../../service/services/service-request.service";

export class ServiceRequestProviderHandler {

  /**
   * POST /service-requests/:serviceRequestId/reject
   *
   * Provider rejects a pending service request directed at them.
   * Only PENDING requests can be rejected.
   *
   * Body:
   *   - message (optional) — reason for rejection, shown to the client
   *
   * NOTE: There is intentionally no "accept" endpoint here.
   * Acceptance is handled exclusively by BookingService.createBookingFromServiceRequest,
   * which atomically creates the Booking and transitions the ServiceRequest to ACCEPTED.
   * Route: POST /bookings/from-service-request/:serviceRequestId
   */
  rejectServiceRequest = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const serviceRequestId = getParam(req.params.serviceRequestId);

      if (!validateObjectId(serviceRequestId)) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: "serviceRequestId must be a valid ObjectId",
        });
        return;
      }

      const userProfileId = getUserProfileId(req);
      if (!userProfileId) {
        res.status(403).json({
          success: false,
          message: "Profile required",
          error: "No active profile found for your account",
        });
        return;
      }

      // Resolve the ProviderProfile linked to this user's profile
      const providerProfile = await ProviderProfileModel.findOne({
        profile:   new Types.ObjectId(userProfileId),
        isDeleted: false,
      }).lean();

      if (!providerProfile) {
        res.status(403).json({
          success: false,
          message: "Provider profile required",
          error: "No active provider profile found for your account",
        });
        return;
      }

      const { message } = req.body as { message?: string };

      const serviceRequest = await serviceRequestService.rejectServiceRequest(
        serviceRequestId,
        providerProfile._id.toString(),
        message,
      );

      res.status(200).json({
        success: true,
        message: "Service request rejected successfully",
        serviceRequest,
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("Cannot reject")) {
          res.status(400).json({
            success: false,
            message: "Cannot reject service request",
            error: error.message,
          });
          return;
        }
        if (error.message.includes("already expired")) {
          res.status(400).json({
            success: false,
            message: "Service request has expired",
            error: error.message,
          });
          return;
        }
        if (
          error.message.includes("not found") ||
          error.message.includes("not the provider")
        ) {
          res.status(404).json({
            success: false,
            message: "Service request not found",
            error: error.message,
          });
          return;
        }
      }
      handleError(res, error, "Failed to reject service request");
    }
  };

  /**
   * GET /service-requests/provider/:providerProfileId
   *
   * Returns a paginated list of service requests directed at a specific provider.
   * The authenticated user must be the owner of the providerProfileId, or an admin.
   *
   * Query params:
   *   - status (optional) — filter by ServiceRequestStatus
   *   - limit  (optional, default 20)
   *   - skip   (optional, default 0)
   */
  getServiceRequestsByProvider = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const providerProfileId = getParam(req.params.providerProfileId);

      if (!validateObjectId(providerProfileId)) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: "providerProfileId must be a valid ObjectId",
        });
        return;
      }

      const status = req.query.status as ServiceRequestStatus | undefined;
      const limit  = parseInt(String(req.query.limit ?? "20"), 10);
      const skip   = parseInt(String(req.query.skip  ?? "0"),  10);

      if (status && !Object.values(ServiceRequestStatus).includes(status)) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: `Invalid status. Must be one of: ${Object.values(ServiceRequestStatus).join(", ")}`,
        });
        return;
      }

      const result = await serviceRequestService.getServiceRequestsByProvider(
        providerProfileId,
        {
          status,
          limit: isNaN(limit) ? 20 : Math.min(100, Math.max(1, limit)),
          skip:  isNaN(skip)  ? 0  : Math.max(0, skip),
        },
      );

      res.status(200).json({
        success: true,
        message: `Retrieved ${result.requests.length} service request(s)`,
        ...result,
      });
    } catch (error) {
      handleError(res, error, "Failed to retrieve provider service requests");
    }
  };

  /**
   * GET /service-requests/provider/:providerProfileId/pending
   *
   * Returns PENDING requests directed at the provider, sorted oldest-first (FIFO inbox).
   * Expired requests are excluded — only genuinely actionable items appear.
   *
   * This is the provider's decision inbox for accept/reject.
   *
   * Query params:
   *   - limit (optional, default 20)
   *   - skip  (optional, default 0)
   */
  getPendingRequestsForProvider = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const providerProfileId = getParam(req.params.providerProfileId);

      if (!validateObjectId(providerProfileId)) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: "providerProfileId must be a valid ObjectId",
        });
        return;
      }

      const limit = parseInt(String(req.query.limit ?? "20"), 10);
      const skip  = parseInt(String(req.query.skip  ?? "0"),  10);

      const result = await serviceRequestService.getPendingRequestsForProvider(
        providerProfileId,
        {
          limit: isNaN(limit) ? 20 : Math.min(100, Math.max(1, limit)),
          skip:  isNaN(skip)  ? 0  : Math.max(0, skip),
        },
      );

      res.status(200).json({
        success: true,
        message: `Retrieved ${result.requests.length} pending request(s)`,
        ...result,
      });
    } catch (error) {
      handleError(res, error, "Failed to retrieve pending service requests");
    }
  };

  /**
   * GET /service-requests/provider/:providerProfileId/activity
   *
   * Returns a compact activity summary for the provider dashboard header.
   * Counts are grouped by status (total, pending, accepted, rejected, expired, cancelled).
   */
  getProviderActivitySummary = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const providerProfileId = getParam(req.params.providerProfileId);

      if (!validateObjectId(providerProfileId)) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: "providerProfileId must be a valid ObjectId",
        });
        return;
      }

      const summary = await serviceRequestService.getActivitySummary(
        providerProfileId,
        "provider",
      );

      res.status(200).json({
        success: true,
        message: "Provider activity summary retrieved successfully",
        summary,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("Invalid actor ID")) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: error.message,
        });
        return;
      }
      handleError(res, error, "Failed to retrieve provider activity summary");
    }
  };
}