import { Response } from "express";
import { getUserProfileId } from "../../middleware/role/role.middleware";
import { bookingService } from "../../service/booking.service";
import { PaymentStatus } from "../../types/bookings.types";
import { AuthenticatedRequest } from "../../types/user.types";
import { getParam, validateObjectId, handleError } from "../../utils/auth/auth.controller.utils";

export class BookingPaymentHandler {

  /**
   * PATCH /bookings/:bookingId/payment-status
   *
   * Updates the payment status of a booking.
   * Intended to be called by the payment gateway webhook handler after a
   * successful payment event. Admin access is also permitted for manual overrides.
   *
   * Body:
   *   - paymentStatus (required) — one of the PaymentStatus enum values
   *
   * When paymentStatus is DEPOSIT_PAID, depositPaid is automatically set to true.
   * Terminal bookings (VALIDATED, COMPLETED, CANCELLED) cannot have their
   * payment status updated.
   *
   * Note: In production this endpoint should be called from a trusted internal
   * service (webhook handler) with appropriate request signing. The route layer
   * should restrict this to admin or service-account tokens only.
   */
  updatePaymentStatus = async (
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

      const { paymentStatus } = req.body as { paymentStatus?: PaymentStatus };

      if (!paymentStatus) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: "paymentStatus is required",
        });
        return;
      }

      if (!Object.values(PaymentStatus).includes(paymentStatus)) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: `Invalid paymentStatus. Must be one of: ${Object.values(PaymentStatus).join(", ")}`,
        });
        return;
      }

      // Record who performed the update for the audit trail
      const actorId = getUserProfileId(req) ?? req.user?._id?.toString();

      const booking = await bookingService.updatePaymentStatus(
        bookingId,
        paymentStatus,
        actorId,
      );

      res.status(200).json({
        success: true,
        message: `Payment status updated to ${paymentStatus}`,
        booking,
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("not found")) {
          res.status(404).json({
            success: false,
            message: "Booking not found",
            error: error.message,
          });
          return;
        }
        if (error.message.includes("Cannot update payment status")) {
          res.status(400).json({
            success: false,
            message: "Cannot update payment status",
            error: error.message,
          });
          return;
        }
      }
      handleError(res, error, "Failed to update payment status");
    }
  };

  /**
   * GET /bookings/:bookingId/payment-summary
   *
   * Returns the financial breakdown of a single booking.
   *
   * Response includes:
   *   - estimatedPrice    — price agreed at booking creation
   *   - finalPrice        — set by provider at completion (may differ from estimated)
   *   - depositAmount     — required upfront deposit (if any)
   *   - depositPaid       — whether the deposit has been paid
   *   - depositRemaining  — outstanding deposit balance
   *   - balanceRemaining  — total outstanding amount after any payments
   *   - currency          — ISO 4217 currency code
   *   - paymentStatus     — current payment status
   *
   * Virtual fields (depositRemaining, balanceRemaining) are computed on the
   * Mongoose document — this endpoint does NOT use .lean() for this reason.
   */
  getPaymentSummary = async (
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

      const summary = await bookingService.getPaymentSummary(bookingId);

      res.status(200).json({
        success: true,
        message: "Payment summary retrieved successfully",
        paymentSummary: summary,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) {
        res.status(404).json({
          success: false,
          message: "Booking not found",
          error: error.message,
        });
        return;
      }
      handleError(res, error, "Failed to retrieve payment summary");
    }
  };
}