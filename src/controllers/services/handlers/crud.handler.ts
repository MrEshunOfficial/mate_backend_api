import { Request, Response } from "express";
import { Types } from "mongoose";
import { Service } from "../../../types/services.types";
import { VerifiedRequest } from "../../../types/user.types";
import { ServiceService } from "../../../service/services/services.service";
import { handleError, getParam, validateObjectId } from "../../../utils/auth/auth.controller.utils";

// ─── Local Error Resolver ─────────────────────────────────────────────────────

function resolveServiceError(
  res: Response,
  error: unknown,
  fallbackMessage: string
): void {
  if (!(error instanceof Error)) {
    handleError(res, error, fallbackMessage);
    return;
  }

  const msg = error.message;

  if (
    msg.includes("not found") ||
    msg.includes("Not found") ||
    msg.includes("Deleted service not found")
  ) {
    res.status(404).json({ success: false, message: msg });
    return;
  }

  if (
    msg.includes("required") ||
    msg.includes("Invalid") ||
    msg.includes("must be") ||
    msg.includes("only valid") ||
    msg.includes("not both") ||
    msg.includes("must specify") ||
    msg.includes("non-negative") ||
    msg.includes("between 0 and 1") ||
    msg.includes("future") ||
    msg.includes("unique tierId") ||
    msg.includes("No valid service IDs")
  ) {
    res.status(400).json({ success: false, message: msg });
    return;
  }

  if (msg.includes("already exists") || msg.includes("already have a service named")) {
    res.status(409).json({ success: false, message: msg });
    return;
  }

  handleError(res, error, fallbackMessage);
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export class ServiceCrudHandler {
  constructor(private readonly serviceService: ServiceService) {
    this.createService       = this.createService.bind(this);
    this.updateService       = this.updateService.bind(this);
    this.deleteService       = this.deleteService.bind(this);
    this.togglePrivateStatus = this.togglePrivateStatus.bind(this);
    this.updateCoverImage    = this.updateCoverImage.bind(this);
    this.removeCoverImage    = this.removeCoverImage.bind(this);
    this.bulkUpdateServices  = this.bulkUpdateServices.bind(this);
  }

  // ─── Create ───────────────────────────────────────────────────────────────

  /**
   * POST /services
   * Body: Partial<Service>
   */
  async createService(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req as VerifiedRequest;
      const serviceData: Partial<Service> = req.body;

      const service = await this.serviceService.createService(serviceData, userId);

      res.status(201).json({ success: true, message: "Service created successfully", service });
    } catch (error) {
      resolveServiceError(res, error, "Failed to create service");
    }
  }

  // ─── Update ───────────────────────────────────────────────────────────────

  /**
   * PUT /services/:id
   * Body: Partial<Service>
   */
  async updateService(req: Request, res: Response): Promise<void> {
    try {
      const serviceId = getParam(req.params.id);

      if (!validateObjectId(serviceId)) {
        res.status(400).json({ success: false, message: "Invalid service ID" });
        return;
      }

      const { userId } = req as VerifiedRequest;
      const service = await this.serviceService.updateService(serviceId, req.body, userId);

      if (!service) {
        res.status(404).json({ success: false, message: "Service not found" });
        return;
      }

      res.status(200).json({ success: true, message: "Service updated successfully", service });
    } catch (error) {
      resolveServiceError(res, error, "Failed to update service");
    }
  }

  // ─── Soft Delete ──────────────────────────────────────────────────────────

  /**
   * DELETE /services/:id
   */
  async deleteService(req: Request, res: Response): Promise<void> {
    try {
      const serviceId = getParam(req.params.id);

      if (!validateObjectId(serviceId)) {
        res.status(400).json({ success: false, message: "Invalid service ID" });
        return;
      }

      const { userId } = req as VerifiedRequest;
      await this.serviceService.deleteService(serviceId, userId);

      res.status(200).json({ success: true, message: "Service deleted successfully" });
    } catch (error) {
      resolveServiceError(res, error, "Failed to delete service");
    }
  }

  // ─── Privacy Toggle ───────────────────────────────────────────────────────

  /**
   * PATCH /services/:id/privacy
   */
  async togglePrivateStatus(req: Request, res: Response): Promise<void> {
    try {
      const serviceId = getParam(req.params.id);

      if (!validateObjectId(serviceId)) {
        res.status(400).json({ success: false, message: "Invalid service ID" });
        return;
      }

      const { userId } = req as VerifiedRequest;
      const service = await this.serviceService.togglePrivateStatus(serviceId, userId);

      if (!service) {
        res.status(404).json({ success: false, message: "Service not found" });
        return;
      }

      res.status(200).json({
        success: true,
        message: `Service is now ${service.isPrivate ? "private" : "public"}`,
        service,
      });
    } catch (error) {
      resolveServiceError(res, error, "Failed to toggle private status");
    }
  }

  // ─── Cover Image ──────────────────────────────────────────────────────────

  /**
   * PATCH /services/:id/cover
   * Body: { coverImageId: string }
   */
  async updateCoverImage(req: Request, res: Response): Promise<void> {
    try {
      const serviceId = getParam(req.params.id);

      if (!validateObjectId(serviceId)) {
        res.status(400).json({ success: false, message: "Invalid service ID" });
        return;
      }

      const { coverImageId } = req.body as { coverImageId: string };

      if (!coverImageId || !validateObjectId(coverImageId)) {
        res.status(400).json({ success: false, message: "A valid coverImageId is required" });
        return;
      }

      const { userId } = req as VerifiedRequest;
      const service = await this.serviceService.updateCoverImageId(
        serviceId,
        new Types.ObjectId(coverImageId),
        userId
      );

      if (!service) {
        res.status(404).json({ success: false, message: "Service not found" });
        return;
      }

      res.status(200).json({ success: true, message: "Cover image updated successfully", service });
    } catch (error) {
      resolveServiceError(res, error, "Failed to update cover image");
    }
  }

  /**
   * DELETE /services/:id/cover
   */
  async removeCoverImage(req: Request, res: Response): Promise<void> {
    try {
      const serviceId = getParam(req.params.id);

      if (!validateObjectId(serviceId)) {
        res.status(400).json({ success: false, message: "Invalid service ID" });
        return;
      }

      const { userId } = req as VerifiedRequest;
      const service = await this.serviceService.updateCoverImageId(serviceId, null, userId);

      if (!service) {
        res.status(404).json({ success: false, message: "Service not found" });
        return;
      }

      res.status(200).json({ success: true, message: "Cover image removed successfully", service });
    } catch (error) {
      resolveServiceError(res, error, "Failed to remove cover image");
    }
  }

  // ─── Bulk Update ──────────────────────────────────────────────────────────

  /**
   * PATCH /services/admin/bulk
   * Body: { serviceIds: string[]; updates: Partial<Service> }
   */
  async bulkUpdateServices(req: Request, res: Response): Promise<void> {
    try {
      const { serviceIds, updates } = req.body as {
        serviceIds: string[];
        updates: Partial<Service>;
      };

      if (!Array.isArray(serviceIds) || serviceIds.length === 0) {
        res.status(400).json({ success: false, message: "serviceIds must be a non-empty array" });
        return;
      }

      if (!updates || typeof updates !== "object") {
        res.status(400).json({ success: false, message: "updates object is required" });
        return;
      }

      const result = await this.serviceService.bulkUpdateServices(serviceIds, updates);

      res.status(200).json({
        success: true,
        message: `${result.modifiedCount} service(s) updated`,
        modifiedCount: result.modifiedCount,
      });
    } catch (error) {
      resolveServiceError(res, error, "Failed to bulk update services");
    }
  }
}