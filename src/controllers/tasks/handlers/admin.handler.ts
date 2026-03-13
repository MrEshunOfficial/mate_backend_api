import { Response } from "express";
import { TaskStatus } from "../../../types/tasks.types";
import {
  handleError,
  validateObjectId,
  AuthenticatedRequest,
  getParam,
} from "../../../utils/auth/auth.controller.utils";
import { taskService } from "../../../service/tasks/task.service";

export class TaskAdminHandler {

  /**
   * GET /tasks/admin/all
   * Query: status?, clientId?, includeDeleted?, limit?, skip?
   *
   * Returns a paginated list of all tasks across all clients.
   * Supports filtering by status, client, and soft-deleted records.
   *
   * Admin only.
   */
  getAllTasks = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const status         = req.query.status         as TaskStatus | undefined;
      const clientId       = req.query.clientId       as string    | undefined;
      const includeDeleted = req.query.includeDeleted === "true";
      const limit          = parseInt(String(req.query.limit ?? "20"), 10);
      const skip           = parseInt(String(req.query.skip  ?? "0"),  10);

      if (status && !Object.values(TaskStatus).includes(status)) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: `Invalid status. Must be one of: ${Object.values(TaskStatus).join(", ")}`,
        });
        return;
      }
      if (clientId && !validateObjectId(clientId)) {
        res.status(400).json({ success: false, message: "Validation error", error: "clientId must be a valid ObjectId" });
        return;
      }

      const result = await taskService.getAllTasks(
        {
          limit: isNaN(limit) ? 20 : Math.min(100, Math.max(1, limit)),
          skip:  isNaN(skip)  ? 0  : Math.max(0, skip),
        },
        { status, clientId, includeDeleted },
      );

      res.status(200).json({
        success: true,
        message: `Retrieved ${result.tasks.length} task(s)`,
        ...result,
      });
    } catch (error) {
      handleError(res, error, "Failed to retrieve all tasks");
    }
  };

  /**
   * GET /tasks/admin/stats
   * Query: clientId? (optional — scope stats to a single client)
   *
   * Platform-wide or per-client task statistics.
   *
   * Metrics:
   *   - counts by status (total, pending, matched, floating, requested,
   *     accepted, converted, cancelled, expired, deleted)
   *   - matchingSuccessRate = (matched + floating + requested + accepted + converted) / total × 100
   *
   * Admin only.
   */
  getTaskStats = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const clientId = req.query.clientId as string | undefined;

      if (clientId && !validateObjectId(clientId)) {
        res.status(400).json({ success: false, message: "Validation error", error: "clientId must be a valid ObjectId" });
        return;
      }

      const stats = await taskService.getTaskStats(clientId);

      res.status(200).json({
        success: true,
        message: "Task statistics retrieved successfully",
        stats,
      });
    } catch (error) {
      handleError(res, error, "Failed to retrieve task statistics");
    }
  };

  /**
   * GET /tasks/client/:clientProfileId/summary
   *
   * Returns a compact activity summary for a client's dashboard header.
   * Runs all counts in parallel without loading full documents.
   *
   * Response:
   *   - totalTasks, activeTasks, convertedTasks, cancelledTasks, expiredTasks
   *
   * Accessible to the owning client or an admin.
   */
  getClientTaskSummary = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const clientProfileId = getParam(req.params.clientProfileId);

      if (!validateObjectId(clientProfileId)) {
        res.status(400).json({ success: false, message: "Validation error", error: "clientProfileId must be a valid ObjectId" });
        return;
      }

      const summary = await taskService.getClientTaskSummary(clientProfileId);

      res.status(200).json({
        success: true,
        message: "Client task summary retrieved successfully",
        summary,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("Invalid client profile ID")) {
        res.status(400).json({ success: false, message: "Validation error", error: error.message });
        return;
      }
      handleError(res, error, "Failed to retrieve client task summary");
    }
  };
}