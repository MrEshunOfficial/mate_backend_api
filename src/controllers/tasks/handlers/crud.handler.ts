import { Response } from "express";
import { Types } from "mongoose";
import { CreateTaskRequestBody, UpdateTaskRequestBody } from "../../../types/tasks.types";
import {
  handleError,
  validateObjectId,
  AuthenticatedRequest,
  getParam,
} from "../../../utils/auth/auth.controller.utils";
import ClientProfileModel from "../../../models/profiles/client.profile.model";
import { TaskStatus } from "../../../types/tasks.types";
import { getUserProfileId } from "../../../middleware/role/role.middleware";
import { taskService } from "../../../service/tasks/task.service";

// ─── Shared helper ────────────────────────────────────────────────────────────

/**
 * Resolves ClientProfile._id for the authenticated user.
 * Returns null and sends the appropriate response if the profile is absent.
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

export class TaskCRUDHandler {

  /**
   * POST /tasks
   *
   * Creates a new task on behalf of a client and immediately triggers
   * intelligent provider matching.
   *
   * Body: CreateTaskRequestBody
   *   - title           (required)
   *   - description     (required)
   *   - locationContext (required) — TaskLocationContext with registeredLocation
   *   - schedule        (required) — { priority, preferredDate?, flexibleDates?, timeSlot? }
   *   - category        (optional) — category ObjectId
   *   - tags            (optional)
   *   - estimatedBudget (optional) — { min?, max?, currency? }
   *   - matchingStrategy (optional) — "intelligent" | "location-only" (default: "intelligent")
   *
   * On success the response includes the task document and matchingSummary
   * (if matching succeeded). Matching failure is non-blocking — the task is
   * still created and returned in PENDING status.
   *
   * Customer role required.
   */
  createTask = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const clientProfileId = await resolveClientProfileId(req, res);
      if (!clientProfileId) return;

      const body = req.body as CreateTaskRequestBody;

      // Required field validation
      if (!body.title?.trim()) {
        res.status(400).json({ success: false, message: "Validation error", error: "title is required" });
        return;
      }
      if (!body.description?.trim()) {
        res.status(400).json({ success: false, message: "Validation error", error: "description is required" });
        return;
      }
      if (!body.locationContext?.registeredLocation) {
        res.status(400).json({ success: false, message: "Validation error", error: "locationContext.registeredLocation is required" });
        return;
      }
      if (!body.schedule?.priority) {
        res.status(400).json({ success: false, message: "Validation error", error: "schedule.priority is required" });
        return;
      }

      const result = await taskService.createTask(clientProfileId, body);

      res.status(201).json({
        success: true,
        message: result.matchingSummary
          ? `Task created and matched with ${result.matchingSummary.totalMatches} provider(s)`
          : "Task created successfully — matching will be retried shortly",
        task:            result.task,
        matchingSummary: result.matchingSummary,
      });
    } catch (error) {
      if (error instanceof Error) {
        const clientErrors = [
          "Client profile not found",
          "Category not found",
          "Invalid",
        ];
        if (clientErrors.some((msg) => error.message.includes(msg))) {
          res.status(400).json({
            success: false,
            message: "Task creation failed",
            error: error.message,
          });
          return;
        }
      }
      handleError(res, error, "Failed to create task");
    }
  };

  /**
   * GET /tasks/:taskId
   * Query: populate? ("true")
   *
   * Fetches a single task by its _id.
   * When populate=true, loads category, clientId, and matchedProviders with
   * their service offerings.
   *
   * Also fires a non-blocking view count increment.
   */
  getTaskById = async (
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

      const populate = req.query.populate === "true";
      const task     = await taskService.getTaskById(taskId, populate);

      if (!task) {
        res.status(404).json({
          success: false,
          message: "Task not found",
          error: `No task found with ID: ${taskId}`,
        });
        return;
      }

      // Fire-and-forget view count increment — never blocks the response
      taskService.incrementViewCount(taskId).catch(() => {});

      res.status(200).json({
        success: true,
        message: "Task retrieved successfully",
        task,
      });
    } catch (error) {
      handleError(res, error, "Failed to retrieve task");
    }
  };

  /**
   * GET /tasks/client/:clientProfileId
   * Query: status?, limit?, skip?
   *
   * Returns a paginated list of tasks belonging to a specific client,
   * most recent first.
   */
  getTasksByClient = async (
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

      const status = req.query.status as TaskStatus | undefined;
      const limit  = parseInt(String(req.query.limit ?? "20"), 10);
      const skip   = parseInt(String(req.query.skip  ?? "0"),  10);

      if (status && !Object.values(TaskStatus).includes(status)) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: `Invalid status. Must be one of: ${Object.values(TaskStatus).join(", ")}`,
        });
        return;
      }

      const result = await taskService.getTasksByClient(clientProfileId, {
        status,
        limit: isNaN(limit) ? 20 : Math.min(100, Math.max(1, limit)),
        skip:  isNaN(skip)  ? 0  : Math.max(0, skip),
      });

      res.status(200).json({
        success: true,
        message: `Retrieved ${result.tasks.length} task(s)`,
        ...result,
      });
    } catch (error) {
      handleError(res, error, "Failed to retrieve client tasks");
    }
  };

  /**
   * PATCH /tasks/:taskId
   *
   * Updates mutable task fields.
   * Only allowed while the task is PENDING, MATCHED, or FLOATING.
   * Tasks in REQUESTED or ACCEPTED status cannot be edited — a provider is engaged.
   *
   * Body: UpdateTaskRequestBody (all fields optional)
   *   - title, description, schedule, estimatedBudget, tags
   *
   * locationContext is intentionally excluded — location cannot be changed after creation.
   * Re-triggers intelligent matching automatically when title, description, or
   * estimatedBudget change.
   *
   * The authenticated user must be the task's owning client.
   */
  updateTask = async (
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

      const clientProfileId = await resolveClientProfileId(req, res);
      if (!clientProfileId) return;

      const updates = req.body as UpdateTaskRequestBody;

      if (Object.keys(updates).length === 0) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: "At least one field must be provided to update",
        });
        return;
      }

      const result = await taskService.updateTask(taskId, clientProfileId, updates);

      res.status(200).json({
        success: true,
        message: result.matchingSummary
          ? `Task updated and re-matched with ${result.matchingSummary.totalMatches} provider(s)`
          : "Task updated successfully",
        task:            result.task,
        matchingSummary: result.matchingSummary,
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("Cannot update") || error.message.includes("may be edited")) {
          res.status(400).json({
            success: false,
            message: "Cannot update task",
            error: error.message,
          });
          return;
        }
        if (error.message.includes("not found")) {
          res.status(404).json({
            success: false,
            message: "Task not found",
            error: error.message,
          });
          return;
        }
      }
      handleError(res, error, "Failed to update task");
    }
  };

  /**
   * DELETE /tasks/:taskId
   *
   * Soft-deletes a task.
   * Only tasks in PENDING, MATCHED, FLOATING, CANCELLED, EXPIRED, or CONVERTED
   * status can be deleted. Tasks in REQUESTED or ACCEPTED status must be
   * cancelled first — a provider is currently engaged.
   *
   * Admin or owning client may call this.
   * deletedBy is recorded from the authenticated user's profile.
   */
  deleteTask = async (
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

      const userProfileId = getUserProfileId(req);

      await taskService.deleteTask(taskId, userProfileId ?? undefined);

      res.status(200).json({
        success: true,
        message: "Task deleted successfully",
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("Cannot delete") || error.message.includes("Cancel the task")) {
          res.status(400).json({
            success: false,
            message: "Cannot delete task",
            error: error.message,
          });
          return;
        }
        if (error.message.includes("not found")) {
          res.status(404).json({
            success: false,
            message: "Task not found",
            error: error.message,
          });
          return;
        }
      }
      handleError(res, error, "Failed to delete task");
    }
  };

  /**
   * POST /tasks/:taskId/restore
   *
   * Restores a previously soft-deleted task.
   * The restored task retains its original status — caller should check
   * whether re-matching is needed via POST /tasks/:taskId/match.
   *
   * Admin only.
   */
  restoreTask = async (
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

      const task = await taskService.restoreTask(taskId);

      if (!task) {
        res.status(404).json({
          success: false,
          message: "Task not found after restore",
          error: `Could not retrieve task with ID: ${taskId} after restoring`,
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Task restored successfully",
        task,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) {
        res.status(404).json({
          success: false,
          message: "Deleted task not found",
          error: error.message,
        });
        return;
      }
      handleError(res, error, "Failed to restore task");
    }
  };
}