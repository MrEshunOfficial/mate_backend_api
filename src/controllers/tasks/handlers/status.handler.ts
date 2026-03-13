import { Response } from "express";
import { ActorRole } from "../../../types/base.types";
import {
  handleError,
  validateObjectId,
  AuthenticatedRequest,
  getParam,
} from "../../../utils/auth/auth.controller.utils";
import { SystemRole } from "../../../types/base.types";
import { getUserProfileId } from "../../../middleware/role/role.middleware";
import { taskService } from "../../../service/tasks/task.service";

const isAdmin = (req: AuthenticatedRequest): boolean => {
  const role = req.user?.systemRole;
  return role === SystemRole.ADMIN || role === SystemRole.SUPER_ADMIN;
};

export class TaskStatusHandler {

  /**
   * POST /tasks/:taskId/cancel
   *
   * Cancels a task. Terminal statuses (CONVERTED, EXPIRED, CANCELLED) cannot
   * be re-cancelled.
   *
   * Body:
   *   - reason      (optional) — cancellation reason
   *   - cancelledBy (optional) — ActorRole, defaults to "customer"
   *
   * Ownership:
   *   - Clients cancel their own tasks (ActorRole.CUSTOMER)
   *   - Admins can cancel any task (ActorRole.ADMIN)
   *   - Provider cancellation should go through BookingService.cancelBooking
   */
  cancelTask = async (
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

      const { reason, cancelledBy } = req.body as {
        reason?: string;
        cancelledBy?: ActorRole;
      };

      const resolvedCancelledBy: ActorRole = isAdmin(req)
        ? ActorRole.ADMIN
        : cancelledBy ?? ActorRole.CUSTOMER;

      const actorId = getUserProfileId(req) ?? req.user?._id?.toString();

      const task = await taskService.cancelTask(taskId, {
        reason,
        cancelledBy: resolvedCancelledBy,
        actorId,
      });

      res.status(200).json({
        success: true,
        message: "Task cancelled successfully",
        task,
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("not found")) {
          res.status(404).json({ success: false, message: "Task not found", error: error.message });
          return;
        }
        if (error.message.includes("Cannot cancel") || error.message.includes("terminal")) {
          res.status(400).json({ success: false, message: "Cannot cancel task", error: error.message });
          return;
        }
      }
      handleError(res, error, "Failed to cancel task");
    }
  };

  /**
   * POST /tasks/:taskId/float
   *
   * Transitions a MATCHED task to FLOATING, opening it to all providers
   * in the vicinity rather than only the matched subset.
   *
   * Used when the client wants to cast a wider net after reviewing the
   * matched provider list, or when matched providers have not responded.
   *
   * The task must be in MATCHED status. The owning client or an admin
   * may call this.
   */
  makeTaskFloating = async (
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

      const task = await taskService.makeTaskFloating(taskId);

      if (!task) {
        res.status(404).json({
          success: false,
          message: "Task not found",
          error: `No task found with ID: ${taskId}`,
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Task is now floating — visible to all providers in your area",
        task,
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("not found")) {
          res.status(404).json({ success: false, message: "Task not found", error: error.message });
          return;
        }
        if (error.message.includes("Cannot") || error.message.includes("status")) {
          res.status(400).json({ success: false, message: "Cannot float task", error: error.message });
          return;
        }
      }
      handleError(res, error, "Failed to make task floating");
    }
  };

  /**
   * POST /tasks/:taskId/expire
   *
   * Marks a single task as EXPIRED.
   * The task must not already be in a terminal status.
   *
   * Admin only — individual expiry is an admin/ops action.
   * Bulk expiry is handled by the cron endpoint below.
   */
  expireTask = async (
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

      const task = await taskService.expireTask(taskId);

      if (!task) {
        res.status(400).json({
          success: false,
          message: "Task cannot be expired",
          error: "Task not found, already deleted, or already in a terminal status",
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Task marked as expired",
        task,
      });
    } catch (error) {
      handleError(res, error, "Failed to expire task");
    }
  };

  /**
   * POST /tasks/admin/expire-overdue
   *
   * Batch-expires all tasks whose expiresAt timestamp has passed.
   * Should be invoked by a scheduled cron job (e.g. every hour).
   *
   * Returns the count of tasks transitioned to EXPIRED.
   * Uses updateMany — no documents are loaded into application memory.
   *
   * Admin only.
   */
  expireOverdueTasks = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const expiredCount = await taskService.expireOverdueTasks();

      res.status(200).json({
        success: true,
        message:
          expiredCount > 0
            ? `Successfully expired ${expiredCount} overdue task(s)`
            : "No overdue tasks found",
        expiredCount,
      });
    } catch (error) {
      handleError(res, error, "Failed to expire overdue tasks");
    }
  };

  /**
   * POST /tasks/:taskId/convert
   *
   * Marks a task as CONVERTED after a booking has been created from it.
   * Stamps convertedToBookingId and convertedAt on the task document.
   *
   * Accepts ACCEPTED or MATCHED tasks only.
   *
   * NOTE: In normal flow this is called internally by BookingService after
   * persisting the Booking document. This endpoint exists for admin corrections
   * and reconciliation of drift (Booking exists but Task is still ACCEPTED).
   *
   * Admin only.
   *
   * Body:
   *   - bookingId (required) — the Booking._id to link
   */
  convertToBooking = async (
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

      const { bookingId } = req.body as { bookingId?: string };

      if (!bookingId) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: "bookingId is required",
        });
        return;
      }

      if (!validateObjectId(bookingId)) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: "bookingId must be a valid ObjectId",
        });
        return;
      }

      const task = await taskService.convertToBooking(taskId, bookingId);

      res.status(200).json({
        success: true,
        message: "Task marked as converted",
        task,
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("Booking not found")) {
          res.status(404).json({ success: false, message: "Booking not found", error: error.message });
          return;
        }
        if (error.message.includes("not found") || error.message.includes("not in a convertible")) {
          res.status(400).json({ success: false, message: "Cannot convert task", error: error.message });
          return;
        }
      }
      handleError(res, error, "Failed to convert task to booking");
    }
  };
}