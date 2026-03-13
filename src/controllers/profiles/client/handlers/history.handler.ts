// controllers/profiles/client/handlers/history.handler.ts
import { Response } from "express";
import { AuthenticatedRequest } from "../../../../types/user.types";
import { getParam } from "../../../../utils/auth/auth.controller.utils";
import { BookingStatus } from "../../../../types/bookings.types";
import { TaskStatus } from "../../../../types/tasks.types";
import { parsePagination, sendError, clientProfileService, sendSuccess, handleServiceError } from "./base.handler";

// ─── Status Whitelists ────────────────────────────────────────────────────────

const VALID_BOOKING_STATUSES = new Set<string>(Object.values(BookingStatus));
const VALID_TASK_STATUSES    = new Set<string>(Object.values(TaskStatus));

export class ClientHistoryHandler {

  /**
   * GET /clients/:profileId/bookings
   *
   * Returns the client's booking history with optional status filter, sorted
   * most-recent first.
   *
   * Query params:
   *   status     — filter by BookingStatus value (optional)
   *   limit/skip — pagination (default 20 / 0, cap 100)
   */
  getBookingHistory = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);
      const { limit, skip } = parsePagination(req.query);
      const statusParam = req.query.status as string | undefined;

      // Validate status param against the BookingStatus enum
      if (statusParam && !VALID_BOOKING_STATUSES.has(statusParam)) {
        sendError(
          res,
          400,
          `Invalid status "${statusParam}". Valid values: ${[...VALID_BOOKING_STATUSES].join(", ")}`
        );
        return;
      }

      const result = await clientProfileService.getBookingHistory(profileId, {
        ...(statusParam && { status: statusParam as BookingStatus }),
        limit,
        skip,
      });

      sendSuccess(res, "Booking history retrieved successfully", result);
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * GET /clients/:profileId/tasks
   *
   * Returns the client's task history with optional status filter, sorted
   * most-recent first.
   *
   * Query params:
   *   status     — filter by TaskStatus value (optional)
   *   limit/skip — pagination (default 20 / 0, cap 100)
   */
  getTaskHistory = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);
      const { limit, skip } = parsePagination(req.query);
      const statusParam = req.query.status as string | undefined;

      if (statusParam && !VALID_TASK_STATUSES.has(statusParam)) {
        sendError(
          res,
          400,
          `Invalid status "${statusParam}". Valid values: ${[...VALID_TASK_STATUSES].join(", ")}`
        );
        return;
      }

      const result = await clientProfileService.getTaskHistory(profileId, {
        ...(statusParam && { status: statusParam as TaskStatus }),
        limit,
        skip,
      });

      sendSuccess(res, "Task history retrieved successfully", result);
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * GET /clients/:profileId/activity-summary
   *
   * Returns a count summary of the client's activity across bookings and tasks.
   * Used by the client dashboard header to drive the stats strip.
   *
   * Response shape:
   * {
   *   totalBookings, activeBookings, completedBookings,
   *   totalTasks,    activeTasks,    completedTasks
   * }
   */
  getActivitySummary = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);

      const summary =
        await clientProfileService.getActivitySummary(profileId);

      sendSuccess(res, "Activity summary retrieved successfully", {
        summary,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };
}