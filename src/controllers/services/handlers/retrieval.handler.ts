import { Request, Response } from "express";
import { ServiceService } from "../../../service/services/services.service";
import { PricingModel } from "../../../types/services.types";
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

  if (msg.includes("Invalid") || msg.includes("required")) {
    res.status(400).json({ success: false, message: msg });
    return;
  }

  handleError(res, error, fallbackMessage);
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export class ServiceRetrievalHandler {
  constructor(private readonly serviceService: ServiceService) {
    this.getServiceById          = this.getServiceById.bind(this);
    this.getServiceBySlug        = this.getServiceBySlug.bind(this);
    this.getActiveServices       = this.getActiveServices.bind(this);
    this.getServicesByProvider   = this.getServicesByProvider.bind(this);
    this.getServicesByCategory   = this.getServicesByCategory.bind(this);
    this.searchServices          = this.searchServices.bind(this);
    this.getCompleteService      = this.getCompleteService.bind(this);
    this.getAutoActivationStatus = this.getAutoActivationStatus.bind(this);
    this.serviceExists           = this.serviceExists.bind(this);
    this.isSlugAvailable         = this.isSlugAvailable.bind(this);
  }

  // ─── Single Fetch ─────────────────────────────────────────────────────────

  /**
   * GET /services/:id
   * Query: details=true
   */
  async getServiceById(req: Request, res: Response): Promise<void> {
    try {
      const serviceId      = getParam(req.params.id);
      const includeDetails = req.query.details === "true";

      if (!validateObjectId(serviceId)) {
        res.status(400).json({ success: false, message: "Invalid service ID" });
        return;
      }

      const service = await this.serviceService.getServiceById(serviceId, includeDetails);

      if (!service) {
        res.status(404).json({ success: false, message: "Service not found" });
        return;
      }

      res.status(200).json({ success: true, message: "Service retrieved", service });
    } catch (error) {
      resolveServiceError(res, error, "Failed to retrieve service");
    }
  }

  /**
   * GET /services/slug/:slug
   * Query: details=true
   */
  async getServiceBySlug(req: Request, res: Response): Promise<void> {
    try {
      const slug           = getParam(req.params.slug);
      const includeDetails = req.query.details === "true";

      if (!slug?.trim()) {
        res.status(400).json({ success: false, message: "Slug is required" });
        return;
      }

      const service = await this.serviceService.getServiceBySlug(slug, includeDetails);

      if (!service) {
        res.status(404).json({ success: false, message: "Service not found" });
        return;
      }

      res.status(200).json({ success: true, message: "Service retrieved", service });
    } catch (error) {
      resolveServiceError(res, error, "Failed to retrieve service");
    }
  }

  /**
   * GET /services/:id/details
   */
  async getCompleteService(req: Request, res: Response): Promise<void> {
    try {
      const serviceId = getParam(req.params.id);

      if (!validateObjectId(serviceId)) {
        res.status(400).json({ success: false, message: "Invalid service ID" });
        return;
      }

      const result = await this.serviceService.getCompleteService(serviceId);

      if (!result.service) {
        res.status(404).json({ success: false, message: "Service not found" });
        return;
      }

      res.status(200).json({ success: true, message: "Service retrieved", ...result });
    } catch (error) {
      resolveServiceError(res, error, "Failed to retrieve service details");
    }
  }

  // ─── List Endpoints ───────────────────────────────────────────────────────

  /**
   * GET /services
   * Query: page, limit
   */
  async getActiveServices(req: Request, res: Response): Promise<void> {
    try {
      const { limit, skip } = parsePagination(req.query);
      const result = await this.serviceService.getActiveServices(limit, skip);

      res.status(200).json({ success: true, message: "Active services retrieved", ...result });
    } catch (error) {
      resolveServiceError(res, error, "Failed to retrieve services");
    }
  }

  /**
   * GET /services/provider/:providerId
   * Query: includeInactive=true, page, limit
   */
  async getServicesByProvider(req: Request, res: Response): Promise<void> {
    try {
      const providerId      = getParam(req.params.providerId);
      const includeInactive = req.query.includeInactive === "true";
      const { limit, skip } = parsePagination(req.query);

      if (!validateObjectId(providerId)) {
        res.status(400).json({ success: false, message: "Invalid provider ID" });
        return;
      }

      const result = await this.serviceService.getServicesByProvider(
        providerId,
        includeInactive,
        limit,
        skip
      );

      res.status(200).json({ success: true, message: "Provider services retrieved", ...result });
    } catch (error) {
      resolveServiceError(res, error, "Failed to retrieve provider services");
    }
  }

  /**
   * GET /services/category/:categoryId
   * Query: page, limit
   */
  async getServicesByCategory(req: Request, res: Response): Promise<void> {
    try {
      const categoryId      = getParam(req.params.categoryId);
      const { limit, skip } = parsePagination(req.query);

      if (!validateObjectId(categoryId)) {
        res.status(400).json({ success: false, message: "Invalid category ID" });
        return;
      }

      const result = await this.serviceService.getServicesByCategory(categoryId, limit, skip);

      res.status(200).json({ success: true, message: "Category services retrieved", ...result });
    } catch (error) {
      resolveServiceError(res, error, "Failed to retrieve category services");
    }
  }

  // ─── Search ───────────────────────────────────────────────────────────────

  /**
   * GET /services/search
   * Query: q (required), categoryId, providerId, minPrice, maxPrice,
   *        pricingModel, currency, page, limit
   */
  async searchServices(req: Request, res: Response): Promise<void> {
    try {
      const searchTerm = (req.query.q as string)?.trim();

      if (!searchTerm) {
        res.status(400).json({ success: false, message: "Search term (q) is required" });
        return;
      }

      const { limit, skip } = parsePagination(req.query);

      const filters: {
        categoryId?: string;
        providerId?: string;
        minPrice?: number;
        maxPrice?: number;
        pricingModel?: PricingModel;
        currency?: string;
      } = {};

      if (req.query.categoryId)   filters.categoryId   = req.query.categoryId as string;
      if (req.query.providerId)   filters.providerId   = req.query.providerId as string;
      if (req.query.minPrice)     filters.minPrice     = Number(req.query.minPrice);
      if (req.query.maxPrice)     filters.maxPrice     = Number(req.query.maxPrice);
      if (req.query.pricingModel) filters.pricingModel = req.query.pricingModel as PricingModel;
      if (req.query.currency)     filters.currency     = req.query.currency as string;

      const result = await this.serviceService.searchServices(searchTerm, filters, limit, skip);

      res.status(200).json({
        success: true,
        message: "Search results retrieved",
        searchTerm,
        filters,
        ...result,
      });
    } catch (error) {
      resolveServiceError(res, error, "Search failed");
    }
  }

  // ─── Auto-Activation Status ───────────────────────────────────────────────

  /**
   * GET /services/:id/activation-status
   * Auth required — userId read from VerifiedRequest cast.
   */
  async getAutoActivationStatus(req: Request, res: Response): Promise<void> {
    try {
      const serviceId = getParam(req.params.id);

      if (!validateObjectId(serviceId)) {
        res.status(400).json({ success: false, message: "Invalid service ID" });
        return;
      }

      // userId is available because authenticateToken runs before this handler.
      // We destructure it only for any future ownership-guard extension.
      const { userId: _userId } = req as VerifiedRequest; // eslint-disable-line @typescript-eslint/no-unused-vars

      const status = await this.serviceService.getAutoActivationStatus(serviceId);

      res.status(200).json({ success: true, message: "Activation status retrieved", ...status });
    } catch (error) {
      resolveServiceError(res, error, "Failed to retrieve activation status");
    }
  }

  // ─── Utility Checks ───────────────────────────────────────────────────────

  /**
   * GET /services/check/exists/:id
   */
  async serviceExists(req: Request, res: Response): Promise<void> {
    try {
      const serviceId = getParam(req.params.id);

      if (!validateObjectId(serviceId)) {
        res.status(200).json({ success: true, exists: false });
        return;
      }

      const exists = await this.serviceService.serviceExists(serviceId);

      res.status(200).json({ success: true, exists });
    } catch (error) {
      resolveServiceError(res, error, "Failed to check service existence");
    }
  }

  /**
   * GET /services/check/slug
   * Query: slug (required), excludeId (optional)
   */
  async isSlugAvailable(req: Request, res: Response): Promise<void> {
    try {
      const slug      = (req.query.slug as string)?.trim().toLowerCase();
      const excludeId = req.query.excludeId as string | undefined;

      if (!slug) {
        res.status(400).json({ success: false, message: "slug query parameter is required" });
        return;
      }

      const available = await this.serviceService.isSlugAvailable(slug, excludeId);

      res.status(200).json({ success: true, slug, available });
    } catch (error) {
      resolveServiceError(res, error, "Failed to check slug availability");
    }
  }
}