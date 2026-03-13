import { Request, Response } from "express";
import { ServiceService } from "../../../service/services/services.service";
import { VerifiedRequest } from "../../../types/user.types";
import { handleError, getParam, validateObjectId } from "../../../utils/auth/auth.controller.utils";

// ─── Pagination Helper ────────────────────────────────────────────────────────

function parsePagination(query: Request["query"]): { limit: number; skip: number } {
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
  const page  = Math.max(Number(query.page) || 1, 1);
  return { limit, skip: (page - 1) * limit };
}

// ─── Local Error Resolver ─────────────────────────────────────────────────────

function resolveServiceError(res: Response, error: unknown, fallbackMessage: string): void {
  if (!(error instanceof Error)) {
    handleError(res, error, fallbackMessage);
    return;
  }

  const msg = error.message;

  if (msg.includes("not found") || msg.includes("Not found")) {
    res.status(404).json({ success: false, message: msg });
    return;
  }

  if (
    msg.includes("Invalid") ||
    msg.includes("required") ||
    msg.includes("without pricing") ||
    msg.includes("No valid service IDs")
  ) {
    res.status(400).json({ success: false, message: msg });
    return;
  }

  handleError(res, error, fallbackMessage);
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export class ServiceAdminHandler {
  constructor(private readonly serviceService: ServiceService) {
    this.getAllServices               = this.getAllServices.bind(this);
    this.getPendingServices          = this.getPendingServices.bind(this);
    this.approveService              = this.approveService.bind(this);
    this.rejectService               = this.rejectService.bind(this);
    this.processScheduledActivations = this.processScheduledActivations.bind(this);
    this.restoreService              = this.restoreService.bind(this);
    this.permanentlyDeleteService    = this.permanentlyDeleteService.bind(this);
    this.getServiceStats             = this.getServiceStats.bind(this);
  }

  // ─── Listing ──────────────────────────────────────────────────────────────

  /**
   * GET /services/admin/all
   * Query: page, limit, includeDeleted=true
   */
  async getAllServices(req: Request, res: Response): Promise<void> {
    try {
      const { limit, skip } = parsePagination(req.query);
      const includeDeleted  = req.query.includeDeleted === "true";

      const result = await this.serviceService.getAllServices(limit, skip, includeDeleted);

      res.status(200).json({ success: true, message: "All services retrieved", ...result });
    } catch (error) {
      resolveServiceError(res, error, "Failed to retrieve services");
    }
  }

  /**
   * GET /services/admin/pending
   * Query: page, limit
   */
  async getPendingServices(req: Request, res: Response): Promise<void> {
    try {
      const { limit, skip } = parsePagination(req.query);
      const result = await this.serviceService.getPendingServices(limit, skip);

      res.status(200).json({ success: true, message: "Pending services retrieved", ...result });
    } catch (error) {
      resolveServiceError(res, error, "Failed to retrieve pending services");
    }
  }

  // ─── Moderation ───────────────────────────────────────────────────────────

  /**
   * POST /services/admin/:id/approve
   */
  async approveService(req: Request, res: Response): Promise<void> {
    try {
      const serviceId  = getParam(req.params.id);
      const { userId } = req as VerifiedRequest;

      if (!validateObjectId(serviceId)) {
        res.status(400).json({ success: false, message: "Invalid service ID" });
        return;
      }

      const service = await this.serviceService.approveService(serviceId, userId);

      if (!service) {
        res.status(404).json({ success: false, message: "Service not found" });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Service approved and activated successfully",
        service,
      });
    } catch (error) {
      resolveServiceError(res, error, "Failed to approve service");
    }
  }

  /**
   * POST /services/admin/:id/reject
   * Body: { reason: string }
   */
  async rejectService(req: Request, res: Response): Promise<void> {
    try {
      const serviceId  = getParam(req.params.id);
      const { userId } = req as VerifiedRequest;
      const { reason } = req.body as { reason?: string };

      if (!validateObjectId(serviceId)) {
        res.status(400).json({ success: false, message: "Invalid service ID" });
        return;
      }

      if (!reason?.trim()) {
        res.status(400).json({ success: false, message: "Rejection reason is required" });
        return;
      }

      const service = await this.serviceService.rejectService(serviceId, userId, reason);

      if (!service) {
        res.status(404).json({ success: false, message: "Service not found" });
        return;
      }

      res.status(200).json({ success: true, message: "Service rejected successfully", service });
    } catch (error) {
      resolveServiceError(res, error, "Failed to reject service");
    }
  }

  // ─── Auto-Activation ──────────────────────────────────────────────────────

  /**
   * POST /services/admin/process-activations
   */
  async processScheduledActivations(req: Request, res: Response): Promise<void> {
    try {
      const summary    = await this.serviceService.processScheduledActivations();
      const hasErrors  = summary.errors.length > 0;

      res.status(200).json({
        success: true,
        message: hasErrors
          ? `Processed activations with ${summary.errors.length} error(s)`
          : "Scheduled activations processed successfully",
        summary,
      });
    } catch (error) {
      resolveServiceError(res, error, "Failed to process scheduled activations");
    }
  }

  // ─── Restore ──────────────────────────────────────────────────────────────

  /**
   * POST /services/admin/:id/restore
   */
  async restoreService(req: Request, res: Response): Promise<void> {
    try {
      const serviceId = getParam(req.params.id);

      if (!validateObjectId(serviceId)) {
        res.status(400).json({ success: false, message: "Invalid service ID" });
        return;
      }

      const service = await this.serviceService.restoreService(serviceId);

      if (!service) {
        res.status(404).json({ success: false, message: "Deleted service not found" });
        return;
      }

      res.status(200).json({ success: true, message: "Service restored successfully", service });
    } catch (error) {
      resolveServiceError(res, error, "Failed to restore service");
    }
  }

  // ─── Permanent Delete ─────────────────────────────────────────────────────

  /**
   * DELETE /services/admin/:id/permanent
   */
  async permanentlyDeleteService(req: Request, res: Response): Promise<void> {
    try {
      const serviceId = getParam(req.params.id);

      if (!validateObjectId(serviceId)) {
        res.status(400).json({ success: false, message: "Invalid service ID" });
        return;
      }

      await this.serviceService.permanentlyDeleteService(serviceId);

      res.status(200).json({ success: true, message: "Service permanently deleted" });
    } catch (error) {
      resolveServiceError(res, error, "Failed to permanently delete service");
    }
  }

  // ─── Statistics ───────────────────────────────────────────────────────────

  /**
   * GET /services/admin/stats
   * Query: providerId (optional)
   */
  async getServiceStats(req: Request, res: Response): Promise<void> {
    try {
      const providerId = req.query.providerId as string | undefined;

      if (providerId && !validateObjectId(providerId)) {
        res.status(400).json({ success: false, message: "Invalid provider ID" });
        return;
      }

      const stats = await this.serviceService.getServiceStats(providerId);

      res.status(200).json({ success: true, message: "Service statistics retrieved", stats });
    } catch (error) {
      resolveServiceError(res, error, "Failed to retrieve service statistics");
    }
  }
}