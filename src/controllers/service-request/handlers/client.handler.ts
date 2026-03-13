import { Response } from "express";
import { ServiceRequestStatus } from "../../../types/service-request.types";
import {
  handleError,
  validateObjectId,
  AuthenticatedRequest,
  getParam,
} from "../../../utils/auth/auth.controller.utils";
import ClientProfileModel from "../../../models/profiles/client.profile.model";
import { Types } from "mongoose";
import { getUserProfileId } from "../../../middleware/role/role.middleware";
import { serviceRequestService } from "../../../service/services/service-request.service";

export class ServiceRequestClientHandler {

  /**
   * POST /service-requests/:serviceRequestId/cancel
   *
   * Client withdraws a pending service request before the provider responds.
   * Only PENDING requests can be cancelled.
   *
   * Body:
   *   - reason (optional) — cancellation reason shown to the provider
   *
   * Once a provider has responded (ACCEPTED / REJECTED), the client must
   * use BookingService.cancelBooking() to cancel the resulting booking.
   */
  cancelServiceRequest = async (
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

      // Resolve the ClientProfile linked to this user's profile
      const clientProfile = await ClientProfileModel.findOne({
        profile:   new Types.ObjectId(userProfileId),
        isDeleted: false,
      }).lean();

      if (!clientProfile) {
        res.status(403).json({
          success: false,
          message: "Client profile required",
          error: "No active client profile found for your account",
        });
        return;
      }

      const { reason } = req.body as { reason?: string };

      const serviceRequest = await serviceRequestService.cancelServiceRequest(
        serviceRequestId,
        clientProfile._id.toString(),
        reason,
      );

      res.status(200).json({
        success: true,
        message: "Service request cancelled successfully",
        serviceRequest,
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("Cannot cancel")) {
          res.status(400).json({
            success: false,
            message: "Cannot cancel service request",
            error: error.message,
          });
          return;
        }
        if (
          error.message.includes("not found") ||
          error.message.includes("do not own")
        ) {
          res.status(404).json({
            success: false,
            message: "Service request not found",
            error: error.message,
          });
          return;
        }
      }
      handleError(res, error, "Failed to cancel service request");
    }
  };

  /**
   * GET /service-requests/client/:clientProfileId
   *
   * Returns a paginated list of service requests made by a specific client.
   * The authenticated user must be the owner of the clientProfileId, or an admin.
   *
   * Query params:
   *   - status (optional) — filter by ServiceRequestStatus
   *   - limit  (optional, default 20)
   *   - skip   (optional, default 0)
   */
  getServiceRequestsByClient = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const clientProfileId = getParam(req.params.clientProfileId);

      if (!validateObjectId(clientProfileId)) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: "clientProfileId must be a valid ObjectId",
        });
        return;
      }

      const status = req.query.status as ServiceRequestStatus | undefined;
      const limit  = parseInt(String(req.query.limit ?? "20"), 10);
      const skip   = parseInt(String(req.query.skip  ?? "0"),  10);

      // Validate status if provided
      if (status && !Object.values(ServiceRequestStatus).includes(status)) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: `Invalid status. Must be one of: ${Object.values(ServiceRequestStatus).join(", ")}`,
        });
        return;
      }

      const result = await serviceRequestService.getServiceRequestsByClient(
        clientProfileId,
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
      handleError(res, error, "Failed to retrieve client service requests");
    }
  };

  /**
   * GET /service-requests/client/:clientProfileId/activity
   *
   * Returns a compact activity summary for the client dashboard header.
   * Counts are grouped by status (total, pending, accepted, rejected, expired, cancelled).
   */
  getClientActivitySummary = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const clientProfileId = getParam(req.params.clientProfileId);

      if (!validateObjectId(clientProfileId)) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: "clientProfileId must be a valid ObjectId",
        });
        return;
      }

      const summary = await serviceRequestService.getActivitySummary(
        clientProfileId,
        "client",
      );

      res.status(200).json({
        success: true,
        message: "Client activity summary retrieved successfully",
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
      handleError(res, error, "Failed to retrieve client activity summary");
    }
  };
}