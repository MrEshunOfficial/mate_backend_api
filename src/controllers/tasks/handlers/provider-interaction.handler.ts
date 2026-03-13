import { Response } from "express";
import { Types } from "mongoose";
import {
  handleError,
  validateObjectId,
  AuthenticatedRequest,
  getParam,
} from "../../../utils/auth/auth.controller.utils";
import ClientProfileModel  from "../../../models/profiles/client.profile.model";
import ProviderProfileModel from "../../../models/profiles/provider.profile.model";
import { getUserProfileId } from "../../../middleware/role/role.middleware";
import { taskService } from "../../../service/tasks/task.service";

// ─── Shared helpers ───────────────────────────────────────────────────────────

const resolveProviderProfileId = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<string | null> => {
  const userProfileId = getUserProfileId(req);
  if (!userProfileId) {
    res.status(403).json({ success: false, message: "Profile required", error: "No active profile found for your account" });
    return null;
  }
  const providerProfile = await ProviderProfileModel.findOne({
    profile: new Types.ObjectId(userProfileId), isDeleted: false,
  }).lean();
  if (!providerProfile) {
    res.status(403).json({ success: false, message: "Provider profile required", error: "No active provider profile found for your account" });
    return null;
  }
  return providerProfile._id.toString();
};

const resolveClientProfileId = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<string | null> => {
  const userProfileId = getUserProfileId(req);
  if (!userProfileId) {
    res.status(403).json({ success: false, message: "Profile required", error: "No active profile found for your account" });
    return null;
  }
  const clientProfile = await ClientProfileModel.findOne({
    profile: new Types.ObjectId(userProfileId), isDeleted: false,
  }).lean();
  if (!clientProfile) {
    res.status(403).json({ success: false, message: "Client profile required", error: "No active client profile found for your account" });
    return null;
  }
  return clientProfile._id.toString();
};

// ─── Handler ──────────────────────────────────────────────────────────────────

export class TaskProviderInteractionHandler {

  /**
   * POST /tasks/:taskId/interest
   *
   * Provider expresses interest in a FLOATING or MATCHED task.
   * The model enforces idempotency — duplicate interest entries are rejected.
   *
   * Body:
   *   - message (optional) — short message shown to the client
   *
   * Provider role required.
   */
  expressProviderInterest = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const taskId = getParam(req.params.taskId);
      if (!validateObjectId(taskId)) {
        res.status(400).json({ success: false, message: "Validation error", error: "taskId must be a valid ObjectId" });
        return;
      }

      const providerProfileId = await resolveProviderProfileId(req, res);
      if (!providerProfileId) return;

      const { message } = req.body as { message?: string };

      const task = await taskService.expressProviderInterest(
        taskId,
        providerProfileId,
        message,
      );

      res.status(200).json({
        success: true,
        message: "Interest expressed successfully — the client will be notified",
        task,
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("not found")) {
          res.status(404).json({ success: false, message: "Task not found", error: error.message });
          return;
        }
        if (error.message.includes("already") || error.message.includes("Cannot")) {
          res.status(400).json({ success: false, message: "Cannot express interest", error: error.message });
          return;
        }
      }
      handleError(res, error, "Failed to express provider interest");
    }
  };

  /**
   * DELETE /tasks/:taskId/interest
   *
   * Provider withdraws previously expressed interest from a task.
   * Can be called by the provider themselves or by an admin.
   *
   * Provider role required.
   */
  withdrawProviderInterest = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const taskId = getParam(req.params.taskId);
      if (!validateObjectId(taskId)) {
        res.status(400).json({ success: false, message: "Validation error", error: "taskId must be a valid ObjectId" });
        return;
      }

      const providerProfileId = await resolveProviderProfileId(req, res);
      if (!providerProfileId) return;

      const task = await taskService.withdrawProviderInterest(taskId, providerProfileId);

      res.status(200).json({
        success: true,
        message: "Interest withdrawn successfully",
        task,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) {
        res.status(404).json({ success: false, message: "Task not found", error: error.message });
        return;
      }
      handleError(res, error, "Failed to withdraw provider interest");
    }
  };

  /**
   * POST /tasks/:taskId/request-provider
   *
   * Client selects a specific provider for their task.
   * The task transitions to REQUESTED status.
   *
   * The provider can be any active provider — they do not have to be in the
   * matchedProviders list. This allows clients to choose a provider they
   * already know (e.g. from their favourites list).
   *
   * Body:
   *   - providerId (required) — the ProviderProfile._id to request
   *   - message    (optional) — message sent to the provider with the request
   *
   * Ownership: only the task's owning client may call this.
   * Customer role required.
   */
  requestProvider = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const taskId = getParam(req.params.taskId);
      if (!validateObjectId(taskId)) {
        res.status(400).json({ success: false, message: "Validation error", error: "taskId must be a valid ObjectId" });
        return;
      }

      const clientProfileId = await resolveClientProfileId(req, res);
      if (!clientProfileId) return;

      const { providerId, message } = req.body as {
        providerId?: string;
        message?: string;
      };

      if (!providerId) {
        res.status(400).json({ success: false, message: "Validation error", error: "providerId is required" });
        return;
      }
      if (!validateObjectId(providerId)) {
        res.status(400).json({ success: false, message: "Validation error", error: "providerId must be a valid ObjectId" });
        return;
      }

      const task = await taskService.requestProvider(
        taskId,
        clientProfileId,
        providerId,
        message,
      );

      res.status(200).json({
        success: true,
        message: "Provider requested — awaiting their response",
        task,
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("not found") || error.message.includes("do not own")) {
          res.status(404).json({ success: false, message: "Task not found", error: error.message });
          return;
        }
        if (error.message.includes("Cannot") || error.message.includes("status")) {
          res.status(400).json({ success: false, message: "Cannot request provider", error: error.message });
          return;
        }
      }
      handleError(res, error, "Failed to request provider");
    }
  };

  /**
   * POST /tasks/:taskId/respond
   *
   * Provider accepts or rejects a task request directed at them.
   *
   * accept → transitions the task to ACCEPTED
   * reject → reverts the task to FLOATING so the client can select another provider
   *
   * Body:
   *   - action  (required) — "accept" | "reject"
   *   - message (optional) — response message shown to the client
   *
   * The model enforces that only the requestedProvider may accept.
   * Provider role required.
   */
  providerRespondToTask = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const taskId = getParam(req.params.taskId);
      if (!validateObjectId(taskId)) {
        res.status(400).json({ success: false, message: "Validation error", error: "taskId must be a valid ObjectId" });
        return;
      }

      const providerProfileId = await resolveProviderProfileId(req, res);
      if (!providerProfileId) return;

      const { action, message } = req.body as {
        action?: "accept" | "reject";
        message?: string;
      };

      if (!action || !["accept", "reject"].includes(action)) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: "action must be 'accept' or 'reject'",
        });
        return;
      }

      const task = await taskService.providerRespondToTask(
        taskId,
        providerProfileId,
        action,
        message,
      );

      const responseMessage =
        action === "accept"
          ? "Task accepted — you can now create a booking from this task"
          : "Task rejected — it has been returned to floating status";

      res.status(200).json({
        success: true,
        message: responseMessage,
        task,
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("not found")) {
          res.status(404).json({ success: false, message: "Task not found", error: error.message });
          return;
        }
        if (
          error.message.includes("not the requested provider") ||
          error.message.includes("Cannot") ||
          error.message.includes("status")
        ) {
          res.status(400).json({ success: false, message: "Cannot respond to task", error: error.message });
          return;
        }
      }
      handleError(res, error, "Failed to respond to task");
    }
  };
}