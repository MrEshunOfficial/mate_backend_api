import { Response } from "express";
import { getUserProfileId } from "../../middleware/role/role.middleware";
import { bookingService } from "../../service/booking.service";
import { BookingStatus, PaymentStatus } from "../../types/bookings.types";
import { AuthenticatedRequest } from "../../types/user.types";
import { getParam, validateObjectId, handleError } from "../../utils/auth/auth.controller.utils";

export class BookingCRUDHandler {

  /**
   * GET /bookings/:bookingId
   * Query: populate? ("true")
   *
   * Fetches a single booking by its _id.
   * When populate=true, loads client, provider, service, task, and serviceRequest refs.
   */
  getBookingById = async (
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

      const populate = req.query.populate === "true";
      const booking  = await bookingService.getBookingById(bookingId, populate);

      if (!booking) {
        res.status(404).json({
          success: false,
          message: "Booking not found",
          error: `No booking found with ID: ${bookingId}`,
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Booking retrieved successfully",
        booking,
      });
    } catch (error) {
      handleError(res, error, "Failed to retrieve booking");
    }
  };

  /**
   * GET /bookings/number/:bookingNumber
   * Query: includeDeleted? ("true")
   *
   * Looks up a booking by its human-readable booking number (e.g. "BK-20241215-A3F9XX").
   * Used in customer support flows and notification deep-links.
   * includeDeleted=true is restricted to admin callers in the route layer.
   */
  getBookingByNumber = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const bookingNumber = getParam(req.params.bookingNumber);

      if (!bookingNumber?.trim()) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: "bookingNumber is required",
        });
        return;
      }

      const includeDeleted = req.query.includeDeleted === "true";
      const booking = await bookingService.getBookingByNumber(
        bookingNumber,
        includeDeleted,
      );

      if (!booking) {
        res.status(404).json({
          success: false,
          message: "Booking not found",
          error: `No booking found with number: ${bookingNumber}`,
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Booking retrieved successfully",
        booking,
      });
    } catch (error) {
      handleError(res, error, "Failed to retrieve booking by number");
    }
  };

  /**
   * GET /bookings/task/:taskId
   *
   * Returns the booking linked to a specific task, if one exists.
   * Useful on the task detail view to show the resulting booking.
   */
  getBookingByTask = async (
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

      const booking = await bookingService.getBookingByTask(taskId);

      if (!booking) {
        res.status(404).json({
          success: false,
          message: "No booking found for this task",
          error: `No booking linked to task ID: ${taskId}`,
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Booking retrieved successfully",
        booking,
      });
    } catch (error) {
      handleError(res, error, "Failed to retrieve booking by task");
    }
  };

  /**
   * GET /bookings/service-request/:serviceRequestId
   *
   * Returns the booking linked to a specific service request, if one exists.
   */
  getBookingByServiceRequest = async (
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

      const booking = await bookingService.getBookingByServiceRequest(serviceRequestId);

      if (!booking) {
        res.status(404).json({
          success: false,
          message: "No booking found for this service request",
          error: `No booking linked to service request ID: ${serviceRequestId}`,
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Booking retrieved successfully",
        booking,
      });
    } catch (error) {
      handleError(res, error, "Failed to retrieve booking by service request");
    }
  };

  /**
   * GET /bookings/client/:clientProfileId
   * Query: status?, paymentStatus?, limit?, skip?
   *
   * Returns a paginated booking history for a specific client.
   * clientProfileId is the IUserProfile._id stored as clientId on Booking.
   */
  getBookingsByClient = async (
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

      const status        = req.query.status        as BookingStatus | undefined;
      const paymentStatus = req.query.paymentStatus as PaymentStatus | undefined;
      const limit         = parseInt(String(req.query.limit ?? "20"), 10);
      const skip          = parseInt(String(req.query.skip  ?? "0"),  10);

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

      const result = await bookingService.getBookingsByClient(clientProfileId, {
        status,
        paymentStatus,
        limit: isNaN(limit) ? 20 : Math.min(100, Math.max(1, limit)),
        skip:  isNaN(skip)  ? 0  : Math.max(0, skip),
      });

      res.status(200).json({
        success: true,
        message: `Retrieved ${result.bookings.length} booking(s)`,
        ...result,
      });
    } catch (error) {
      handleError(res, error, "Failed to retrieve client bookings");
    }
  };

  /**
   * GET /bookings/provider/:providerProfileId
   * Query: status?, paymentStatus?, limit?, skip?
   *
   * Returns a paginated booking list for a specific provider.
   */
  getBookingsByProvider = async (
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

      const status        = req.query.status        as BookingStatus | undefined;
      const paymentStatus = req.query.paymentStatus as PaymentStatus | undefined;
      const limit         = parseInt(String(req.query.limit ?? "20"), 10);
      const skip          = parseInt(String(req.query.skip  ?? "0"),  10);

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

      const result = await bookingService.getBookingsByProvider(providerProfileId, {
        status,
        paymentStatus,
        limit: isNaN(limit) ? 20 : Math.min(100, Math.max(1, limit)),
        skip:  isNaN(skip)  ? 0  : Math.max(0, skip),
      });

      res.status(200).json({
        success: true,
        message: `Retrieved ${result.bookings.length} booking(s)`,
        ...result,
      });
    } catch (error) {
      handleError(res, error, "Failed to retrieve provider bookings");
    }
  };

  /**
   * DELETE /bookings/:bookingId
   *
   * Soft-deletes a booking.
   * Only VALIDATED, COMPLETED, or CANCELLED bookings can be deleted.
   * Active bookings must be cancelled first via the cancel endpoint.
   */
  deleteBooking = async (
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

      const userProfileId = getUserProfileId(req);

      await bookingService.deleteBooking(bookingId, userProfileId ?? undefined);

      res.status(200).json({
        success: true,
        message: "Booking deleted successfully",
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("Cannot delete")) {
          res.status(400).json({
            success: false,
            message: "Cannot delete booking",
            error: error.message,
          });
          return;
        }
        if (error.message.includes("not found")) {
          res.status(404).json({
            success: false,
            message: "Booking not found",
            error: error.message,
          });
          return;
        }
      }
      handleError(res, error, "Failed to delete booking");
    }
  };

  /**
   * POST /bookings/:bookingId/restore
   *
   * Restores a previously soft-deleted booking. Admin only.
   */
  restoreBooking = async (
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

      const booking = await bookingService.restoreBooking(bookingId);

      if (!booking) {
        res.status(404).json({
          success: false,
          message: "Booking not found after restore",
          error: `Could not retrieve booking with ID: ${bookingId} after restoring`,
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Booking restored successfully",
        booking,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) {
        res.status(404).json({
          success: false,
          message: "Deleted booking not found",
          error: error.message,
        });
        return;
      }
      handleError(res, error, "Failed to restore booking");
    }
  };
}