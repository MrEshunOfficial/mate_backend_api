import { Response } from "express";
import { bookingService } from "../../service/booking.service";
import { ActorRole } from "../../types/base.types";
import { BookingStatus, PaymentStatus } from "../../types/bookings.types";
import { AuthenticatedRequest } from "../../types/user.types";
import { getParam, validateObjectId, handleError } from "../../utils/auth/auth.controller.utils";

export class BookingAdminHandler {

  /**
   * POST /bookings/:bookingId/resolve-dispute
   *
   * Admin resolves a DISPUTED booking.
   * Transition: DISPUTED → VALIDATED | COMPLETED
   *
   * Body:
   *   - resolution (required) — "approve" (→ VALIDATED) | "complete" (→ COMPLETED)
   *   - notes      (optional) — admin notes appended to statusHistory
   *
   * "approve"  = finds in favour of the provider (work was satisfactory)
   * "complete" = admin override for partial-work scenarios where VALIDATED
   *              is not appropriate
   *
   * Admin only.
   */
  resolveDispute = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const bookingId = getParam(req.params.bookingId);

      if (!validateObjectId(bookingId)) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: "bookingId must be a valid ObjectId",
        });
        return;
      }

      const { resolution, notes } = req.body as {
        resolution?: "approve" | "complete";
        notes?: string;
      };

      if (!resolution || !["approve", "complete"].includes(resolution)) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: "resolution must be 'approve' or 'complete'",
        });
        return;
      }

      const adminId = req.user!._id.toString();

      const booking = await bookingService.resolveDispute(
        bookingId,
        adminId,
        resolution,
        notes,
      );

      const newStatus = resolution === "approve" ? BookingStatus.VALIDATED : BookingStatus.COMPLETED;

      res.status(200).json({
        success: true,
        message: `Dispute resolved — booking transitioned to ${newStatus}`,
        booking,
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("not found") || error.message.includes("not in DISPUTED")) {
          res.status(404).json({
            success: false,
            message: "Booking not found or not in DISPUTED status",
            error: error.message,
          });
          return;
        }
      }
      handleError(res, error, "Failed to resolve dispute");
    }
  };

  /**
   * GET /bookings/admin/active
   * Query: limit?, skip?
   *
   * Returns all platform-wide active bookings (CONFIRMED + IN_PROGRESS).
   * Used by the admin operations dashboard for live oversight.
   * Sorted by scheduledDate ascending (soonest first).
   *
   * Admin only.
   */
  getActiveBookings = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const limit = parseInt(String(req.query.limit ?? "50"), 10);
      const skip  = parseInt(String(req.query.skip  ?? "0"),  10);

      const result = await bookingService.getActiveBookings({
        limit: isNaN(limit) ? 50 : Math.min(200, Math.max(1, limit)),
        skip:  isNaN(skip)  ? 0  : Math.max(0, skip),
      });

      res.status(200).json({
        success: true,
        message: `Retrieved ${result.bookings.length} active booking(s)`,
        ...result,
      });
    } catch (error) {
      handleError(res, error, "Failed to retrieve active bookings");
    }
  };

  /**
   * GET /bookings/admin/pending-validation
   * Query: limit?, skip?
   *
   * Returns bookings currently awaiting client validation.
   * Used by the admin dashboard to monitor stalled validation steps.
   * Sorted by createdAt descending (most recent first).
   *
   * Admin only.
   */
  getBookingsPendingValidation = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const limit = parseInt(String(req.query.limit ?? "50"), 10);
      const skip  = parseInt(String(req.query.skip  ?? "0"),  10);

      const result = await bookingService.getBookingsPendingValidation({
        limit: isNaN(limit) ? 50 : Math.min(200, Math.max(1, limit)),
        skip:  isNaN(skip)  ? 0  : Math.max(0, skip),
      });

      res.status(200).json({
        success: true,
        message: `Retrieved ${result.bookings.length} booking(s) awaiting validation`,
        ...result,
      });
    } catch (error) {
      handleError(res, error, "Failed to retrieve bookings pending validation");
    }
  };

  /**
   * GET /bookings/admin/disputed
   * Query: limit?, skip?
   *
   * Returns all DISPUTED bookings, sorted by disputedAt ascending so the
   * oldest unresolved disputes surface first for admin triage.
   *
   * Admin only.
   */
  getDisputedBookings = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const limit = parseInt(String(req.query.limit ?? "50"), 10);
      const skip  = parseInt(String(req.query.skip  ?? "0"),  10);

      const result = await bookingService.getDisputedBookings({
        limit: isNaN(limit) ? 50 : Math.min(200, Math.max(1, limit)),
        skip:  isNaN(skip)  ? 0  : Math.max(0, skip),
      });

      res.status(200).json({
        success: true,
        message: `Retrieved ${result.bookings.length} disputed booking(s)`,
        ...result,
      });
    } catch (error) {
      handleError(res, error, "Failed to retrieve disputed bookings");
    }
  };

  /**
   * GET /bookings/admin/all
   * Query: status?, paymentStatus?, clientId?, providerId?, includeDeleted?, limit?, skip?
   *
   * Platform-wide paginated list of all bookings.
   * Supports filtering by status, payment status, client, provider, and soft-deleted records.
   *
   * Admin only.
   */
  getAllBookings = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const status         = req.query.status         as BookingStatus | undefined;
      const paymentStatus  = req.query.paymentStatus  as PaymentStatus | undefined;
      const clientId       = req.query.clientId       as string | undefined;
      const providerId     = req.query.providerId     as string | undefined;
      const includeDeleted = req.query.includeDeleted === "true";
      const limit          = parseInt(String(req.query.limit ?? "20"), 10);
      const skip           = parseInt(String(req.query.skip  ?? "0"),  10);

      if (status && !Object.values(BookingStatus).includes(status)) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: `Invalid status. Must be one of: ${Object.values(BookingStatus).join(", ")}`,
        });
        return;
      }
      if (paymentStatus && !Object.values(PaymentStatus).includes(paymentStatus)) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: `Invalid paymentStatus. Must be one of: ${Object.values(PaymentStatus).join(", ")}`,
        });
        return;
      }
      if (clientId && !validateObjectId(clientId)) {
        res.status(400).json({ success: false, message: "Validation error", error: "clientId must be a valid ObjectId" });
        return;
      }
      if (providerId && !validateObjectId(providerId)) {
        res.status(400).json({ success: false, message: "Validation error", error: "providerId must be a valid ObjectId" });
        return;
      }

      const result = await bookingService.getAllBookings(
        {
          limit: isNaN(limit) ? 20 : Math.min(100, Math.max(1, limit)),
          skip:  isNaN(skip)  ? 0  : Math.max(0, skip),
        },
        { status, paymentStatus, clientId, providerId, includeDeleted },
      );

      res.status(200).json({
        success: true,
        message: `Retrieved ${result.bookings.length} booking(s)`,
        ...result,
      });
    } catch (error) {
      handleError(res, error, "Failed to retrieve all bookings");
    }
  };

  /**
   * GET /bookings/admin/stats
   * Query: actorId?, actorRole? ("customer" | "provider")
   *
   * Platform-wide or per-actor booking statistics.
   * Omit actorId/actorRole for a system-wide overview.
   *
   * Metrics:
   *   - counts by status (total, confirmed, inProgress, awaitingValidation,
   *     validated, completed, disputed, cancelled, deleted)
   *   - completionRate  = (VALIDATED + COMPLETED) / total × 100
   *   - disputeRate     = DISPUTED / (DISPUTED + resolved) × 100
   *   - averageRating   = mean customerRating across validated bookings
   *   - totalRevenue    = sum of finalPrice on validated/completed bookings
   *
   * Admin only.
   */
  getBookingStats = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const actorId   = req.query.actorId   as string | undefined;
      const actorRole = req.query.actorRole as "customer" | "provider" | undefined;

      if (actorId && !validateObjectId(actorId)) {
        res.status(400).json({ success: false, message: "Validation error", error: "actorId must be a valid ObjectId" });
        return;
      }

      if (actorRole && !["customer", "provider"].includes(actorRole)) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: "actorRole must be 'customer' or 'provider'",
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

      const resolvedActorRole =
        actorRole === "customer"
          ? ActorRole.CUSTOMER
          : actorRole === "provider"
            ? ActorRole.PROVIDER
            : undefined;

      const stats = await bookingService.getBookingStats({
        actorId,
        actorRole: resolvedActorRole as ActorRole.CUSTOMER | ActorRole.PROVIDER | undefined,
      });

      res.status(200).json({
        success: true,
        message: "Booking statistics retrieved successfully",
        stats,
      });
    } catch (error) {
      handleError(res, error, "Failed to retrieve booking statistics");
    }
  };
}