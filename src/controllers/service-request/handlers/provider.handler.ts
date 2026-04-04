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
import { bookingService } from "../../../service/booking.service";
import ServiceRequestModel from "../../../models/service/service-request.model";

export class ServiceRequestProviderHandler {
  /**
   * POST /service-requests/:serviceRequestId/accept
   *
   * Provider accepts a PENDING service request directed at them.
   * Delegates to bookingService.createBookingFromServiceRequest, which
   * atomically transitions the ServiceRequest to ACCEPTED and creates
   * the linked Booking in a single operation.
   *
   * Returns both the updated ServiceRequest and the new Booking so the
   * client can immediately redirect to the booking detail page.
   *
   * Body:
   *   - message (optional) — acceptance message shown to the client
   */
  /**
   * POST /service-requests/:serviceRequestId/accept
   *
   * Provider accepts a PENDING service request directed at them.
   * Delegates to bookingService.createBookingFromServiceRequest, which
   * atomically transitions the ServiceRequest to ACCEPTED and creates
   * the linked Booking. After that resolves, the updated ServiceRequest
   * is fetched separately since the booking service only returns the booking.
   *
   * Returns both documents so the frontend can redirect to the booking page.
   *
   * Body:
   *   - message (optional) — acceptance message shown to the client
   */
  acceptServiceRequest = async (
    req: AuthenticatedRequest,
    res: Response,
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

      const providerProfile = await ProviderProfileModel.findOne({
        profile: new Types.ObjectId(userProfileId),
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

      // createBookingFromServiceRequest atomically:
      //   1. Transitions the ServiceRequest → ACCEPTED
      //   2. Creates and persists the Booking
      // It returns { booking, serviceRequestUpdated } — not the SR document
      // itself, so we fetch the updated SR in parallel with returning the booking.
      const { booking } = await bookingService.createBookingFromServiceRequest(
        serviceRequestId,
        providerProfile._id.toString(),
        {}, // no overrides — inherit serviceLocation, scheduledDate, timeSlot from SR
      );
      if (message?.trim()) {
        await ServiceRequestModel.findByIdAndUpdate(serviceRequestId, {
          "providerResponse.message": message.trim(),
        });
      }
      // Fetch the now-ACCEPTED service request so the client has the full
      // updated document (status, convertedToBookingId, providerResponse, etc.)
      const serviceRequest =
        await serviceRequestService.getServiceRequestById(serviceRequestId);

      if (!serviceRequest) {
        // Booking was created — this is a non-fatal inconsistency.
        // Return success with just the booking rather than rolling back.
        res.status(201).json({
          success: true,
          message: "Service request accepted and booking created successfully",
          booking,
        });
        return;
      }

      res.status(201).json({
        success: true,
        message: "Service request accepted and booking created successfully",
        serviceRequest,
        booking,
      });
    } catch (error) {
      if (error instanceof Error) {
        if (
          error.message.includes("Cannot accept") ||
          error.message.includes("already accepted") ||
          error.message.includes("already expired")
        ) {
          res.status(400).json({
            success: false,
            message: "Cannot accept service request",
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
      handleError(res, error, "Failed to accept service request");
    }
  };

  /**
   * POST /service-requests/:serviceRequestId/reject
   *
   * Provider rejects a pending service request directed at them.
   * Only PENDING requests can be rejected.
   *
   * Body:
   *   - message (optional) — reason for rejection, shown to the client
   */
  rejectServiceRequest = async (
    req: AuthenticatedRequest,
    res: Response,
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

      const providerProfile = await ProviderProfileModel.findOne({
        profile: new Types.ObjectId(userProfileId),
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
   *
   * Query params:
   *   - status (optional) — filter by ServiceRequestStatus
   *   - limit  (optional, default 20)
   *   - skip   (optional, default 0)
   */
  getServiceRequestsByProvider = async (
    req: AuthenticatedRequest,
    res: Response,
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
      const limit = parseInt(String(req.query.limit ?? "20"), 10);
      const skip = parseInt(String(req.query.skip ?? "0"), 10);

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
          skip: isNaN(skip) ? 0 : Math.max(0, skip),
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
   * Provider decision inbox — PENDING requests only, sorted oldest-first (FIFO).
   * Expired requests are excluded.
   *
   * Query params:
   *   - limit (optional, default 20)
   *   - skip  (optional, default 0)
   */
  getPendingRequestsForProvider = async (
    req: AuthenticatedRequest,
    res: Response,
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
      const skip = parseInt(String(req.query.skip ?? "0"), 10);

      const result = await serviceRequestService.getPendingRequestsForProvider(
        providerProfileId,
        {
          limit: isNaN(limit) ? 20 : Math.min(100, Math.max(1, limit)),
          skip: isNaN(skip) ? 0 : Math.max(0, skip),
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
   * Compact activity counts for the provider dashboard header.
   */
  getProviderActivitySummary = async (
    req: AuthenticatedRequest,
    res: Response,
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
      if (
        error instanceof Error &&
        error.message.includes("Invalid actor ID")
      ) {
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
