import { Response } from "express";
import { Types } from "mongoose";
import { getUserProfileId } from "../../middleware/role/role.middleware";
import ProviderProfileModel from "../../models/profiles/provider.profile.model";
import { CreateBookingFromTaskInput, bookingService, CreateBookingFromServiceRequestInput } from "../../service/booking.service";
import { AuthenticatedRequest } from "../../types/user.types";
import { getParam, validateObjectId, handleError } from "../../utils/auth/auth.controller.utils";

export class BookingCreationHandler {

  /**
   * POST /bookings/from-task/:taskId
   *
   * Converts an ACCEPTED task into a confirmed booking.
   *
   * Called by the task's owning client after a provider has accepted the task.
   * The caller must supply the specific service they want to book (the task entity
   * does not store a serviceId — it only matches providers).
   *
   * Body: CreateBookingFromTaskInput
   *   - serviceId           (required) — must belong to the accepted provider
   *   - serviceLocation     (required)
   *   - scheduledDate       (required)
   *   - scheduledTimeSlot   (required) — { start, end }
   *   - serviceDescription  (required)
   *   - specialInstructions (optional)
   *   - estimatedPrice      (optional) — defaults to service basePrice
   *   - currency            (optional, default GHS)
   *
   * The task must be in ACCEPTED status. On success:
   *   - A Booking is created with status CONFIRMED
   *   - The Task is stamped CONVERTED
   */
  createBookingFromTask = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const taskId = getParam(req.params.taskId);

      if (!validateObjectId(taskId)) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: "taskId must be a valid ObjectId",
        });
        return;
      }

      const body = req.body as CreateBookingFromTaskInput;

      // Required field validation
      if (!body.serviceId) {
        res.status(400).json({ success: false, message: "Validation error", error: "serviceId is required" });
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
      if (!body.serviceDescription?.trim()) {
        res.status(400).json({ success: false, message: "Validation error", error: "serviceDescription is required" });
        return;
      }

      const scheduledDate = new Date(body.scheduledDate);
      if (isNaN(scheduledDate.getTime())) {
        res.status(400).json({ success: false, message: "Validation error", error: "scheduledDate must be a valid date string" });
        return;
      }

      const result = await bookingService.createBookingFromTask(taskId, {
        ...body,
        scheduledDate,
      });

      res.status(201).json({
        success: true,
        message: "Booking created successfully from task",
        booking:     result.booking,
        taskUpdated: result.taskUpdated,
      });
    } catch (error) {
      if (error instanceof Error) {
        const clientErrors = [
          "not in ACCEPTED status",
          "does not belong to the accepted provider",
          "Invalid",
          "not found",
          "inactive",
        ];
        if (clientErrors.some((msg) => error.message.includes(msg))) {
          res.status(400).json({
            success: false,
            message: "Booking creation failed",
            error: error.message,
          });
          return;
        }
      }
      handleError(res, error, "Failed to create booking from task");
    }
  };

  /**
   * POST /bookings/from-service-request/:serviceRequestId
   *
   * Provider accepts a PENDING ServiceRequest and immediately creates a confirmed booking.
   *
   * This is the single endpoint for a provider to "accept" a service request.
   * It atomically transitions the ServiceRequest → ACCEPTED and creates the Booking.
   *
   * Body: CreateBookingFromServiceRequestInput (all fields optional — defaults come from the SR)
   *   - serviceDescription  (optional) — defaults to SR.clientMessage
   *   - specialInstructions (optional)
   *   - estimatedPrice      (optional) — defaults to SR.estimatedBudget.max then service.basePrice
   *   - scheduledDate       (optional) — overrides SR.scheduledDate
   *   - scheduledTimeSlot   (optional) — overrides SR.scheduledTimeSlot
   *
   * The ServiceRequest must be PENDING and must belong to the authenticated provider.
   * Expired requests cannot be accepted.
   */
  createBookingFromServiceRequest = async (
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

      // Resolve the ProviderProfile linked to the authenticated user
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

      const body = req.body as CreateBookingFromServiceRequestInput;

      // Coerce scheduledDate if provided
      let overrides: CreateBookingFromServiceRequestInput = { ...body };
      if (body.scheduledDate) {
        const scheduledDate = new Date(body.scheduledDate);
        if (isNaN(scheduledDate.getTime())) {
          res.status(400).json({
            success: false,
            message: "Validation error",
            error: "scheduledDate must be a valid date string",
          });
          return;
        }
        overrides = { ...overrides, scheduledDate };
      }

      const result = await bookingService.createBookingFromServiceRequest(
        serviceRequestId,
        providerProfile._id.toString(),
        overrides,
      );

      res.status(201).json({
        success: true,
        message: "Service request accepted and booking created successfully",
        booking:                result.booking,
        serviceRequestUpdated:  result.serviceRequestUpdated,
      });
    } catch (error) {
      if (error instanceof Error) {
        const clientErrors = [
          "not in PENDING status",
          "does not belong to this provider",
          "expired",
          "not found",
          "inactive",
          "Invalid",
        ];
        if (clientErrors.some((msg) => error.message.includes(msg))) {
          res.status(400).json({
            success: false,
            message: "Booking creation failed",
            error: error.message,
          });
          return;
        }
      }
      handleError(res, error, "Failed to create booking from service request");
    }
  };
}