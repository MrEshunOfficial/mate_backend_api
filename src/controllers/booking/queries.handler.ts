import { Response } from "express";
import { bookingService } from "../../service/booking.service";
import { ActorRole } from "../../types/base.types";
import { AuthenticatedRequest } from "../../types/user.types";
import { getParam, validateObjectId, handleError } from "../../utils/auth/auth.controller.utils";

export class BookingQueriesHandler {

  /**
   * GET /bookings/provider/:providerProfileId/upcoming
   * Query: limit?, skip?
   *
   * Returns upcoming CONFIRMED bookings for a provider, sorted soonest-first.
   * This is the provider's daily schedule view.
   *
   * Only future-dated CONFIRMED bookings are included — past bookings and
   * bookings in other statuses are excluded.
   */
  getUpcomingBookings = async (
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

      const result = await bookingService.getUpcomingBookings(providerProfileId, {
        limit: isNaN(limit) ? 20 : Math.min(100, Math.max(1, limit)),
        skip:  isNaN(skip)  ? 0  : Math.max(0, skip),
      });

      res.status(200).json({
        success: true,
        message: `Retrieved ${result.bookings.length} upcoming booking(s)`,
        ...result,
      });
    } catch (error) {
      handleError(res, error, "Failed to retrieve upcoming bookings");
    }
  };

  /**
   * GET /bookings/provider/:providerProfileId/calendar
   * Query: startDate (required), endDate (required), limit?, skip?
   *
   * Returns bookings for a provider within a calendar date range.
   * Includes both CONFIRMED and IN_PROGRESS bookings (i.e. everything occupying
   * time in the provider's schedule). Sorted by scheduledDate ascending.
   *
   * Used by the provider's schedule/calendar view.
   */
  getBookingsByDateRange = async (
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

      const { startDate: startDateStr, endDate: endDateStr } = req.query as {
        startDate?: string;
        endDate?:   string;
      };

      if (!startDateStr || !endDateStr) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: "startDate and endDate query parameters are required",
        });
        return;
      }

      const startDate = new Date(startDateStr);
      const endDate   = new Date(endDateStr);

      if (isNaN(startDate.getTime())) {
        res.status(400).json({ success: false, message: "Validation error", error: "startDate must be a valid date string" });
        return;
      }
      if (isNaN(endDate.getTime())) {
        res.status(400).json({ success: false, message: "Validation error", error: "endDate must be a valid date string" });
        return;
      }

      const limit = parseInt(String(req.query.limit ?? "50"), 10);
      const skip  = parseInt(String(req.query.skip  ?? "0"),  10);

      const result = await bookingService.getBookingsByDateRange(
        providerProfileId,
        startDate,
        endDate,
        {
          limit: isNaN(limit) ? 50 : Math.min(200, Math.max(1, limit)),
          skip:  isNaN(skip)  ? 0  : Math.max(0, skip),
        },
      );

      res.status(200).json({
        success: true,
        message: `Retrieved ${result.bookings.length} booking(s) in date range`,
        ...result,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("Start date must be before")) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: error.message,
        });
        return;
      }
      handleError(res, error, "Failed to retrieve bookings by date range");
    }
  };

  /**
   * GET /bookings/:actorType/:actorId/activity
   *
   * Returns compact booking counts for a client or provider dashboard header.
   * actorType: "client" | "provider"
   *
   * Counts:
   *   - total
   *   - active (CONFIRMED + IN_PROGRESS)
   *   - awaitingValidation
   *   - completed (VALIDATED + COMPLETED)
   *   - cancelled
   *   - disputed
   */
  getActivitySummary = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const actorId   = getParam(req.params.actorId);
      const actorType = getParam(req.params.actorType) as "client" | "provider";

      if (!validateObjectId(actorId)) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: "actorId must be a valid ObjectId",
        });
        return;
      }

      if (!["client", "provider"].includes(actorType)) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: "actorType must be 'client' or 'provider'",
        });
        return;
      }

      const actorRole =
        actorType === "client" ? ActorRole.CUSTOMER : ActorRole.PROVIDER;

      const summary = await bookingService.getActivitySummary(actorId, actorRole);

      res.status(200).json({
        success: true,
        message: "Activity summary retrieved successfully",
        summary,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("Invalid actor ID")) {
        res.status(400).json({ success: false, message: "Validation error", error: error.message });
        return;
      }
      handleError(res, error, "Failed to retrieve activity summary");
    }
  };
}