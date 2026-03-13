import { Response } from "express";
import {
  handleError,
  validateObjectId,
  AuthenticatedRequest,
  getParam,
} from "../../../utils/auth/auth.controller.utils";
import { taskService } from "../../../service/tasks/task.service";

export class TaskMatchingHandler {

  /**
   * POST /tasks/:taskId/match
   *
   * Manually re-triggers provider matching for a task.
   *
   * Use cases:
   *   - Initial matching failed (e.g. temporary OSM outage)
   *   - Task content was edited outside updateTask (admin correction)
   *   - New providers have registered in the task's area since creation
   *
   * Only tasks in PENDING, MATCHED, or FLOATING status can be re-matched.
   * Tasks in REQUESTED, ACCEPTED, or terminal statuses are ineligible.
   *
   * Query params:
   *   - strategy (optional) — "intelligent" | "location-only" (default: "intelligent")
   *
   * Returns the updated task document and a MatchingSummary.
   * Accessible to the owning client and admins.
   */
  triggerMatching = async (
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

      const strategyParam = req.query.strategy as string | undefined;
      const validStrategies = ["intelligent", "location-only"];

      if (strategyParam && !validStrategies.includes(strategyParam)) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: `strategy must be one of: ${validStrategies.join(", ")}`,
        });
        return;
      }

      const strategy = (strategyParam ?? "intelligent") as "intelligent" | "location-only";

      const { task, summary } = await taskService.triggerMatching(taskId, strategy);

      res.status(200).json({
        success: true,
        message:
          summary.totalMatches > 0
            ? `Matching complete — found ${summary.totalMatches} provider(s) using ${summary.strategy} strategy`
            : "Matching complete — no providers found. Task status set to FLOATING.",
        task,
        matchingSummary: summary,
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("not found")) {
          res.status(404).json({ success: false, message: "Task not found", error: error.message });
          return;
        }
        if (error.message.includes("Cannot re-trigger") || error.message.includes("can be re-matched")) {
          res.status(400).json({ success: false, message: "Cannot trigger matching", error: error.message });
          return;
        }
      }
      handleError(res, error, "Failed to trigger matching");
    }
  };

  /**
   * GET /tasks/:taskId/matched-providers
   *
   * Returns the matched provider list for a task with full ProviderProfile
   * documents populated — ready for the client to review and select a provider.
   *
   * Includes:
   *   - matchedProviders[] with populated providerId (businessName, locationData,
   *     serviceOfferings, businessGalleryImages)
   *   - matchingCriteria (search terms, radius, location source used)
   *   - task summary (_id, status, title, matchingAttemptedAt)
   *
   * Providers are in descending matchScore order (already stored that way).
   * Accessible to the owning client and admins.
   */
  getMatchedProviders = async (
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

      const result = await taskService.getMatchedProviders(taskId);

      res.status(200).json({
        success: true,
        message: `Retrieved ${result.matchedProviders.length} matched provider(s)`,
        ...result,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) {
        res.status(404).json({ success: false, message: "Task not found", error: error.message });
        return;
      }
      handleError(res, error, "Failed to retrieve matched providers");
    }
  };

  /**
   * GET /tasks/:taskId/interested-providers
   *
   * Returns the list of providers who have expressed interest in the task,
   * with their ProviderProfile documents populated.
   *
   * Should only be surfaced to the task's owning client or an admin.
   * The response includes the provider's businessName, locationData,
   * providerContactInfo, serviceOfferings, plus the expressedAt timestamp
   * and their optional message.
   *
   * Customer role required (owning client) or admin.
   */
  getInterestedProviders = async (
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

      const result = await taskService.getInterestedProviders(taskId);

      res.status(200).json({
        success: true,
        message: `Retrieved ${result.providers.length} interested provider(s)`,
        ...result,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) {
        res.status(404).json({ success: false, message: "Task not found", error: error.message });
        return;
      }
      handleError(res, error, "Failed to retrieve interested providers");
    }
  };
}