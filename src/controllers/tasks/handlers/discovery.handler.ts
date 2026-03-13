import { Response } from "express";
import { TaskStatus } from "../../../types/tasks.types";
import {
  handleError,
  validateObjectId,
  AuthenticatedRequest,
  getParam,
} from "../../../utils/auth/auth.controller.utils";
import { taskService } from "../../../service/tasks/task.service";

export class TaskDiscoveryHandler {

  /**
   * GET /tasks/floating
   *
   * Returns tasks currently in FLOATING status — visible to all providers
   * in the region as open opportunities.
   *
   * This is the provider's "find tasks" feed. Clients can also view the
   * floating feed to understand market demand.
   *
   * Query params:
   *   - region     (optional) — filter by region string
   *   - city       (optional) — filter by city string
   *   - categoryId (optional) — filter by category ObjectId
   *   - limit      (optional, default 20)
   *   - skip       (optional, default 0)
   */
  getFloatingTasks = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const region     = req.query.region     as string | undefined;
      const city       = req.query.city       as string | undefined;
      const categoryId = req.query.categoryId as string | undefined;
      const limit      = parseInt(String(req.query.limit ?? "20"), 10);
      const skip       = parseInt(String(req.query.skip  ?? "0"),  10);

      if (categoryId && !validateObjectId(categoryId)) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: "categoryId must be a valid ObjectId",
        });
        return;
      }

      const result = await taskService.getFloatingTasks(
        { region, city, categoryId },
        {
          limit: isNaN(limit) ? 20 : Math.min(100, Math.max(1, limit)),
          skip:  isNaN(skip)  ? 0  : Math.max(0, skip),
        },
      );

      res.status(200).json({
        success: true,
        message: `Found ${result.total} floating task(s)`,
        ...result,
      });
    } catch (error) {
      handleError(res, error, "Failed to retrieve floating tasks");
    }
  };

  /**
   * GET /tasks/provider/:providerProfileId/matched
   *
   * Returns tasks where the given provider appears in the matchedProviders array.
   * Used by the provider dashboard to surface pending matched opportunities.
   *
   * Only MATCHED and FLOATING tasks are returned — once a task is REQUESTED
   * or beyond, it is no longer an open opportunity for this provider.
   *
   * Sorted by matchScore descending within each provider's matched set.
   *
   * Query params: limit?, skip?
   * Provider role required.
   */
  getMatchedTasksForProvider = async (
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

      const result = await taskService.getMatchedTasksForProvider(
        providerProfileId,
        {
          limit: isNaN(limit) ? 20 : Math.min(100, Math.max(1, limit)),
          skip:  isNaN(skip)  ? 0  : Math.max(0, skip),
        },
      );

      res.status(200).json({
        success: true,
        message: `Found ${result.total} matched task(s)`,
        ...result,
      });
    } catch (error) {
      handleError(res, error, "Failed to retrieve matched tasks for provider");
    }
  };

  /**
   * GET /tasks/provider/:providerProfileId/requests
   *
   * Returns REQUESTED tasks directed at a specific provider —
   * tasks awaiting the provider's accept/reject decision.
   *
   * Sorted by requestedAt ascending (oldest request first).
   *
   * Query params: limit?, skip?
   * Provider role required.
   */
  getPendingRequestsForProvider = async (
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

      const result = await taskService.getPendingRequestsForProvider(
        providerProfileId,
        {
          limit: isNaN(limit) ? 20 : Math.min(100, Math.max(1, limit)),
          skip:  isNaN(skip)  ? 0  : Math.max(0, skip),
        },
      );

      res.status(200).json({
        success: true,
        message: `Found ${result.total} pending task request(s)`,
        ...result,
      });
    } catch (error) {
      handleError(res, error, "Failed to retrieve pending task requests for provider");
    }
  };

  /**
   * GET /tasks/provider/:providerProfileId/interested
   *
   * Returns tasks where the given provider has previously expressed interest.
   * Useful for the provider to track their pending interest applications.
   *
   * Query params: limit?, skip?
   * Provider role required.
   */
  getTasksWithProviderInterest = async (
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

      const result = await taskService.getTasksWithProviderInterest(
        providerProfileId,
        {
          limit: isNaN(limit) ? 20 : Math.min(100, Math.max(1, limit)),
          skip:  isNaN(skip)  ? 0  : Math.max(0, skip),
        },
      );

      res.status(200).json({
        success: true,
        message: `Found ${result.total} task(s) with your interest`,
        ...result,
      });
    } catch (error) {
      handleError(res, error, "Failed to retrieve tasks with provider interest");
    }
  };

  /**
   * GET /tasks/search
   *
   * Full-text search across task title, description, and tags.
   * Uses the MongoDB text index defined on the TaskModel schema.
   *
   * Query params:
   *   - q          (required) — search term
   *   - status     (optional) — filter by TaskStatus
   *   - categoryId (optional) — filter by category ObjectId
   *   - region     (optional) — filter by region string
   *   - clientId   (optional) — scope to a specific client
   *   - limit      (optional, default 20)
   *   - skip       (optional, default 0)
   *
   * Results sorted by text relevance score descending.
   */
  searchTasks = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const searchTerm = req.query.q as string | undefined;

      if (!searchTerm?.trim()) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: "Search term 'q' is required",
        });
        return;
      }

      const status     = req.query.status     as TaskStatus | undefined;
      const categoryId = req.query.categoryId as string   | undefined;
      const region     = req.query.region     as string   | undefined;
      const clientId   = req.query.clientId   as string   | undefined;
      const limit      = parseInt(String(req.query.limit ?? "20"), 10);
      const skip       = parseInt(String(req.query.skip  ?? "0"),  10);

      if (status && !Object.values(TaskStatus).includes(status)) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: `Invalid status. Must be one of: ${Object.values(TaskStatus).join(", ")}`,
        });
        return;
      }
      if (categoryId && !validateObjectId(categoryId)) {
        res.status(400).json({ success: false, message: "Validation error", error: "categoryId must be a valid ObjectId" });
        return;
      }
      if (clientId && !validateObjectId(clientId)) {
        res.status(400).json({ success: false, message: "Validation error", error: "clientId must be a valid ObjectId" });
        return;
      }

      const result = await taskService.searchTasks(
        searchTerm.trim(),
        { status, categoryId, region, clientId },
        {
          limit: isNaN(limit) ? 20 : Math.min(100, Math.max(1, limit)),
          skip:  isNaN(skip)  ? 0  : Math.max(0, skip),
        },
      );

      res.status(200).json({
        success: true,
        message: `Found ${result.total} task(s) matching "${searchTerm}"`,
        ...result,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("Search term is required")) {
        res.status(400).json({ success: false, message: "Validation error", error: error.message });
        return;
      }
      handleError(res, error, "Failed to search tasks");
    }
  };
}