import { Response } from "express";
import { Types } from "mongoose";
import { CreateServiceRequestBody } from "../../../types/service-request.types";
import {
  handleError,
  validateObjectId,
  AuthenticatedRequest,
} from "../../../utils/auth/auth.controller.utils";
import ProfileModel from "../../../models/profiles/base.profile.model";
import ClientProfileModel from "../../../models/profiles/client.profile.model";
import ProviderProfileModel from "../../../models/profiles/provider.profile.model";
import { getParam } from "../../../utils/auth/auth.controller.utils";
import { getUserProfileId } from "../../../middleware/role/role.middleware";
import { serviceRequestService } from "../../../service/services/service-request.service";

export class ServiceRequestCRUDHandler {

  /**
   * POST /service-requests
   *
   * Creates a new service request from a client to a specific provider.
   * Requires CUSTOMER role.
   *
   * Body: CreateServiceRequestBody
   *   - serviceId          (required)
   *   - providerId         (required)
   *   - serviceLocation    (required) — UserLocation
   *   - scheduledDate      (required) — must be in the future
   *   - scheduledTimeSlot  (required) — { start, end }
   *   - clientMessage      (optional)
   *   - estimatedBudget    (optional) — { min?, max?, currency? }
   *   - discoveryContext   (optional) — how the client found this provider
   */
  createServiceRequest = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      // getUserProfileId returns the IUserProfile._id attached by role middleware
      const userProfileId = getUserProfileId(req);
      if (!userProfileId) {
        res.status(403).json({
          success: false,
          message: "Profile required",
          error: "No active profile found — cannot create a service request",
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

      const body = req.body as CreateServiceRequestBody;

      // Required field validation
      if (!body.serviceId) {
        res.status(400).json({ success: false, message: "Validation error", error: "serviceId is required" });
        return;
      }
      if (!body.providerId) {
        res.status(400).json({ success: false, message: "Validation error", error: "providerId is required" });
        return;
      }
      if (!body.serviceLocation) {
        res.status(400).json({ success: false, message: "Validation error", error: "serviceLocation is required" });
        return;
      }
      if (!body.scheduledDate) {
        res.status(400).json({ success: false, message: "Validation error", error: "scheduledDate is required" });
        return;
      }
      if (!body.scheduledTimeSlot?.start || !body.scheduledTimeSlot?.end) {
        res.status(400).json({ success: false, message: "Validation error", error: "scheduledTimeSlot.start and .end are required" });
        return;
      }

      // Coerce scheduledDate to a Date object (it arrives as a string from JSON)
      const scheduledDate = new Date(body.scheduledDate);
      if (isNaN(scheduledDate.getTime())) {
        res.status(400).json({ success: false, message: "Validation error", error: "scheduledDate must be a valid date string" });
        return;
      }

      const serviceRequest = await serviceRequestService.createServiceRequest(
        clientProfile._id.toString(),
        { ...body, scheduledDate },
      );

      res.status(201).json({
        success: true,
        message: "Service request created successfully",
        serviceRequest,
      });
    } catch (error) {
      if (error instanceof Error) {
        const userFacingErrors = [
          "already have a pending or accepted request",
          "does not belong to the specified provider",
          "Scheduled date must be in the future",
          "Service not found",
          "Provider profile not found",
          "Client profile not found",
          "Invalid",
        ];
        if (userFacingErrors.some((msg) => error.message.includes(msg))) {
          res.status(400).json({
            success: false,
            message: "Service request creation failed",
            error: error.message,
          });
          return;
        }
      }
      handleError(res, error, "Failed to create service request");
    }
  };

  /**
   * GET /service-requests/:serviceRequestId
   *
   * Fetches a single service request by its _id.
   * Accessible to the client, provider, or admin on the request.
   *
   * Query params:
   *   - populate (optional, "true") — populates client, provider, service refs
   */
  getServiceRequestById = async (
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

      const populate = req.query.populate === "true";
      const serviceRequest = await serviceRequestService.getServiceRequestById(
        serviceRequestId,
        populate,
      );

      if (!serviceRequest) {
        res.status(404).json({
          success: false,
          message: "Service request not found",
          error: `No service request found with ID: ${serviceRequestId}`,
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Service request retrieved successfully",
        serviceRequest,
      });
    } catch (error) {
      handleError(res, error, "Failed to retrieve service request");
    }
  };

  /**
   * DELETE /service-requests/:serviceRequestId
   *
   * Soft-deletes a service request.
   * Only REJECTED, EXPIRED, or CANCELLED requests can be deleted.
   * ACCEPTED requests are intentionally blocked — the linked booking depends on them.
   *
   * Accessible to: the owning client, the provider, or an admin.
   * The deletedBy field records who performed the deletion for audit purposes.
   */
  deleteServiceRequest = async (
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

      // Use the authenticated user's profile as the deletedBy actor
      const userProfileId = getUserProfileId(req);

      await serviceRequestService.deleteServiceRequest(
        serviceRequestId,
        userProfileId ?? undefined,
      );

      res.status(200).json({
        success: true,
        message: "Service request deleted successfully",
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("Cannot delete")) {
          res.status(400).json({
            success: false,
            message: "Cannot delete service request",
            error: error.message,
          });
          return;
        }
        if (error.message.includes("not found")) {
          res.status(404).json({
            success: false,
            message: "Service request not found",
            error: error.message,
          });
          return;
        }
      }
      handleError(res, error, "Failed to delete service request");
    }
  };

  /**
   * POST /service-requests/:serviceRequestId/restore
   *
   * Restores a previously soft-deleted service request.
   * Admin only.
   */
  restoreServiceRequest = async (
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

      const serviceRequest = await serviceRequestService.restoreServiceRequest(
        serviceRequestId,
      );

      if (!serviceRequest) {
        res.status(404).json({
          success: false,
          message: "Service request not found after restore",
          error: `Could not retrieve service request with ID: ${serviceRequestId} after restoring`,
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Service request restored successfully",
        serviceRequest,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) {
        res.status(404).json({
          success: false,
          message: "Deleted service request not found",
          error: error.message,
        });
        return;
      }
      handleError(res, error, "Failed to restore service request");
    }
  };
}