import { Response } from "express";
import { Types } from "mongoose";
import { getUserProfileId } from "../../middleware/role/role.middleware";
import ClientProfileModel from "../../models/profiles/client.profile.model";
import ProviderProfileModel from "../../models/profiles/provider.profile.model";
import { bookingService } from "../../service/booking.service";
import { SystemRole, ActorRole } from "../../types/base.types";
import { ValidateBookingRequestBody } from "../../types/bookings.types";
import { AuthenticatedRequest } from "../../types/user.types";
import { getParam, validateObjectId, handleError } from "../../utils/auth/auth.controller.utils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isAdmin = (req: AuthenticatedRequest): boolean => {
  const role = req.user?.systemRole;
  return role === SystemRole.ADMIN || role === SystemRole.SUPER_ADMIN;
};

/**
 * Resolves the ProviderProfile._id for the authenticated provider user.
 * Returns null and sends the response if the profile cannot be found.
 */
const resolveProviderProfileId = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<string | null> => {
  const userProfileId = getUserProfileId(req);
  if (!userProfileId) {
    res.status(403).json({
      success: false,
      message: "Profile required",
      error: "No active profile found for your account",
    });
    return null;
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
    return null;
  }

  return providerProfile._id.toString();
};

/**
 * Resolves the ClientProfile._id for the authenticated client user.
 * Returns null and sends the response if the profile cannot be found.
 */
const resolveClientProfileId = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<string | null> => {
  const userProfileId = getUserProfileId(req);
  if (!userProfileId) {
    res.status(403).json({
      success: false,
      message: "Profile required",
      error: "No active profile found for your account",
    });
    return null;
  }

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
    return null;
  }

  return clientProfile._id.toString();
};

// ─── Handler ──────────────────────────────────────────────────────────────────

export class BookingStatusHandler {

  /**
   * POST /bookings/:bookingId/start
   *
   * Provider marks a confirmed booking as in-progress (work has started).
   * Transition: CONFIRMED → IN_PROGRESS
   *
   * The authenticated user must be the provider on the booking.
   */
  startService = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const bookingId = getParam(req.params.bookingId);
      if (!validateObjectId(bookingId)) {
        res.status(400).json({ success: false, message: "Validation error", error: "bookingId must be a valid ObjectId" });
        return;
      }

      const providerProfileId = await resolveProviderProfileId(req, res);
      if (!providerProfileId) return; // response already sent

      const booking = await bookingService.startService(bookingId, providerProfileId);

      res.status(200).json({
        success: true,
        message: "Service started successfully",
        booking,
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("not found") || error.message.includes("not the provider")) {
          res.status(404).json({ success: false, message: "Booking not found", error: error.message });
          return;
        }
        if (error.message.includes("Cannot") || error.message.includes("status")) {
          res.status(400).json({ success: false, message: "Cannot start service", error: error.message });
          return;
        }
      }
      handleError(res, error, "Failed to start service");
    }
  };

  /**
   * POST /bookings/:bookingId/complete
   *
   * Provider marks work as done and requests client validation.
   * Transition: IN_PROGRESS → AWAITING_VALIDATION
   *
   * Body:
   *   - finalPrice     (optional) — final price for hourly/per-unit services
   *   - providerMessage (optional) — message shown to client during validation
   *
   * The authenticated user must be the provider on the booking.
   */
  completeService = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const bookingId = getParam(req.params.bookingId);
      if (!validateObjectId(bookingId)) {
        res.status(400).json({ success: false, message: "Validation error", error: "bookingId must be a valid ObjectId" });
        return;
      }

      const providerProfileId = await resolveProviderProfileId(req, res);
      if (!providerProfileId) return;

      const { finalPrice, providerMessage } = req.body as {
        finalPrice?: number;
        providerMessage?: string;
      };

      if (finalPrice !== undefined && (typeof finalPrice !== "number" || finalPrice < 0)) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: "finalPrice must be a non-negative number",
        });
        return;
      }

      const booking = await bookingService.completeService(bookingId, providerProfileId, {
        finalPrice,
        providerMessage,
      });

      res.status(200).json({
        success: true,
        message: "Service marked as complete — awaiting client validation",
        booking,
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("not found") || error.message.includes("not the provider")) {
          res.status(404).json({ success: false, message: "Booking not found", error: error.message });
          return;
        }
        if (error.message.includes("Cannot") || error.message.includes("negative")) {
          res.status(400).json({ success: false, message: "Cannot complete service", error: error.message });
          return;
        }
      }
      handleError(res, error, "Failed to complete service");
    }
  };

  /**
   * POST /bookings/:bookingId/validate
   *
   * Client approves or disputes the completed booking.
   * Transition: AWAITING_VALIDATION → VALIDATED | DISPUTED
   *
   * Body (discriminated union — exactly one of these shapes):
   *   Approval:  { approved: true,  rating: 1-5, review?: string }
   *   Dispute:   { approved: false, disputeReason: string }
   *
   * The authenticated user must be the client on the booking.
   * Rating is required on the approval path (1–5).
   */
  validateCompletion = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const bookingId = getParam(req.params.bookingId);
      if (!validateObjectId(bookingId)) {
        res.status(400).json({ success: false, message: "Validation error", error: "bookingId must be a valid ObjectId" });
        return;
      }

      const clientProfileId = await resolveClientProfileId(req, res);
      if (!clientProfileId) return;

      const payload = req.body as ValidateBookingRequestBody;

      if (typeof payload.approved !== "boolean") {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: "approved must be a boolean",
        });
        return;
      }

      if (payload.approved) {
        if (typeof payload.rating !== "number" || payload.rating < 1 || payload.rating > 5) {
          res.status(400).json({
            success: false,
            message: "Validation error",
            error: "rating is required and must be a number between 1 and 5 when approving",
          });
          return;
        }
      } else {
        if (!payload.disputeReason?.trim()) {
          res.status(400).json({
            success: false,
            message: "Validation error",
            error: "disputeReason is required when disputing a booking",
          });
          return;
        }
      }

      const booking = await bookingService.validateCompletion(
        bookingId,
        clientProfileId,
        payload,
      );

      const message = payload.approved
        ? "Booking validated and marked as complete"
        : "Booking disputed — an admin will review shortly";

      res.status(200).json({
        success: true,
        message,
        booking,
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("not found") || error.message.includes("do not own")) {
          res.status(404).json({ success: false, message: "Booking not found", error: error.message });
          return;
        }
        if (error.message.includes("Cannot validate") || error.message.includes("Rating")) {
          res.status(400).json({ success: false, message: "Cannot validate booking", error: error.message });
          return;
        }
      }
      handleError(res, error, "Failed to validate booking completion");
    }
  };

  /**
   * POST /bookings/:bookingId/cancel
   *
   * Cancels a booking. Can be called by the client, provider, or admin.
   * Only CONFIRMED and IN_PROGRESS bookings can be cancelled.
   *
   * Body:
   *   - reason      (required)
   *   - cancelledBy (required) — "customer" | "provider" | "admin"
   *
   * Ownership guards are enforced:
   *   - "customer" callers → must be the booking's client
   *   - "provider" callers → must be the booking's provider
   *   - "admin"    callers → bypass ownership checks
   */
  cancelBooking = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const bookingId = getParam(req.params.bookingId);
      if (!validateObjectId(bookingId)) {
        res.status(400).json({ success: false, message: "Validation error", error: "bookingId must be a valid ObjectId" });
        return;
      }

      const { reason, cancelledBy } = req.body as {
        reason?: string;
        cancelledBy?: ActorRole;
      };

      if (!reason?.trim()) {
        res.status(400).json({ success: false, message: "Validation error", error: "reason is required" });
        return;
      }

      const validRoles: ActorRole[] = [ActorRole.CUSTOMER, ActorRole.PROVIDER, ActorRole.ADMIN];
      if (!cancelledBy || !validRoles.includes(cancelledBy)) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: `cancelledBy must be one of: ${validRoles.join(", ")}`,
        });
        return;
      }

      // Resolve the actor ID based on who is cancelling
      let actorId: string;

      if (isAdmin(req)) {
        // Admins can cancel on behalf of any role — use their user _id as the actor
        actorId = req.user!._id.toString();
      } else if (cancelledBy === ActorRole.CUSTOMER) {
        const clientProfileId = await resolveClientProfileId(req, res);
        if (!clientProfileId) return;
        actorId = clientProfileId;
      } else if (cancelledBy === ActorRole.PROVIDER) {
        const providerProfileId = await resolveProviderProfileId(req, res);
        if (!providerProfileId) return;
        actorId = providerProfileId;
      } else {
        res.status(403).json({
          success: false,
          message: "Access denied",
          error: "Admin privileges are required to cancel on behalf of the admin role",
        });
        return;
      }

      const booking = await bookingService.cancelBooking(
        bookingId,
        reason,
        cancelledBy,
        actorId,
      );

      res.status(200).json({
        success: true,
        message: "Booking cancelled successfully",
        booking,
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("not found")) {
          res.status(404).json({ success: false, message: "Booking not found", error: error.message });
          return;
        }
        if (
          error.message.includes("Cannot cancel") ||
          error.message.includes("do not own") ||
          error.message.includes("not the provider")
        ) {
          res.status(400).json({ success: false, message: "Cannot cancel booking", error: error.message });
          return;
        }
      }
      handleError(res, error, "Failed to cancel booking");
    }
  };

  /**
   * POST /bookings/:bookingId/reschedule
   *
   * Reschedules a confirmed booking to a new date and/or time slot.
   * Only CONFIRMED bookings can be rescheduled.
   *
   * Body:
   *   - newDate      (required) — must be in the future
   *   - newTimeSlot  (optional) — { start, end }
   *   - actorRole    (required) — "customer" | "provider" | "admin"
   *
   * Ownership guards mirror cancelBooking.
   */
  rescheduleBooking = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const bookingId = getParam(req.params.bookingId);
      if (!validateObjectId(bookingId)) {
        res.status(400).json({ success: false, message: "Validation error", error: "bookingId must be a valid ObjectId" });
        return;
      }

      const { newDate, newTimeSlot, actorRole } = req.body as {
        newDate?: string;
        newTimeSlot?: { start: string; end: string };
        actorRole?: ActorRole;
      };

      if (!newDate) {
        res.status(400).json({ success: false, message: "Validation error", error: "newDate is required" });
        return;
      }

      const scheduledDate = new Date(newDate);
      if (isNaN(scheduledDate.getTime())) {
        res.status(400).json({ success: false, message: "Validation error", error: "newDate must be a valid date string" });
        return;
      }

      const validRoles: ActorRole[] = [ActorRole.CUSTOMER, ActorRole.PROVIDER, ActorRole.ADMIN];
      if (!actorRole || !validRoles.includes(actorRole)) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: `actorRole must be one of: ${validRoles.join(", ")}`,
        });
        return;
      }

      // Resolve actor ID
      let actorId: string;

      if (isAdmin(req)) {
        actorId = req.user!._id.toString();
      } else if (actorRole === ActorRole.CUSTOMER) {
        const clientProfileId = await resolveClientProfileId(req, res);
        if (!clientProfileId) return;
        actorId = clientProfileId;
      } else if (actorRole === ActorRole.PROVIDER) {
        const providerProfileId = await resolveProviderProfileId(req, res);
        if (!providerProfileId) return;
        actorId = providerProfileId;
      } else {
        res.status(403).json({
          success: false,
          message: "Access denied",
          error: "Admin privileges are required to reschedule with admin actor role",
        });
        return;
      }

      const booking = await bookingService.rescheduleBooking(
        bookingId,
        actorId,
        actorRole,
        scheduledDate,
        newTimeSlot,
      );

      res.status(200).json({
        success: true,
        message: "Booking rescheduled successfully",
        booking,
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("not found")) {
          res.status(404).json({ success: false, message: "Booking not found", error: error.message });
          return;
        }
        if (
          error.message.includes("Cannot reschedule") ||
          error.message.includes("do not own") ||
          error.message.includes("not the provider") ||
          error.message.includes("must be in the future")
        ) {
          res.status(400).json({ success: false, message: "Cannot reschedule booking", error: error.message });
          return;
        }
      }
      handleError(res, error, "Failed to reschedule booking");
    }
  };
}