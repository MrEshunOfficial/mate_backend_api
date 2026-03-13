import { Response } from "express";
import { BrowseLocationContext } from "../../../types/location.types";
import { handleError, AuthenticatedRequest } from "../../../utils/auth/auth.controller.utils";
import { serviceRequestService } from "../../../service/services/service-request.service";

export class ServiceRequestBrowseHandler {

  /**
   * GET /service-requests/browse
   *
   * Returns active services near the client's GPS location, sorted nearest-first.
   * This is the Flow 2 entry point — called when the client opens the browse screen.
   *
   * Query params:
   *   - categoryId   (optional) — filter by category ObjectId
   *   - searchTerm   (optional) — full-text search
   *   - priceMin     (optional) — minimum base price
   *   - priceMax     (optional) — maximum base price
   *   - currency     (optional) — ISO 4217 currency code
   *   - page         (optional, default 1)
   *   - limit        (optional, default 20)
   *
   * Body: { locationContext: BrowseLocationContext }
   *
   * The locationContext must include a gpsLocation fix and an initialRadiusKm.
   * isExpanded should be false on the first call.
   */
  browseServices = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const { locationContext, categoryId, searchTerm, priceRange } = req.body as {
        locationContext: BrowseLocationContext;
        categoryId?: string;
        searchTerm?: string;
        priceRange?: { min?: number; max?: number; currency?: string };
      };

      if (!locationContext) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: "locationContext is required in the request body",
        });
        return;
      }

      if (!locationContext.gpsLocation) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: "locationContext.gpsLocation is required",
        });
        return;
      }

      if (!locationContext.initialRadiusKm || locationContext.initialRadiusKm <= 0) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: "locationContext.initialRadiusKm must be a positive number",
        });
        return;
      }

      const page  = parseInt(String(req.query.page  ?? "1"),  10);
      const limit = parseInt(String(req.query.limit ?? "20"), 10);

      const result = await serviceRequestService.browseServices({
        locationContext,
        categoryId,
        searchTerm,
        priceRange,
        page:  isNaN(page)  ? 1  : Math.max(1, page),
        limit: isNaN(limit) ? 20 : Math.min(100, Math.max(1, limit)),
      });

      res.status(200).json({
        success: true,
        message: `Found ${result.totalResults} service(s) near your location`,
        ...result,
      });
    } catch (error) {
      handleError(res, error, "Failed to browse services");
    }
  };

  /**
   * POST /service-requests/browse/expand
   *
   * Expands the search radius and returns the next page of results.
   * Called when the client taps "load more" or "expand search".
   *
   * Body:
   *   {
   *     originalLocationContext: BrowseLocationContext,
   *     expandedRadiusKm: number,   // must be greater than initialRadiusKm, capped at 100
   *     page: number,
   *     limit?: number
   *   }
   *
   * Returns an updated locationContext with isExpanded: true that the client
   * should persist and pass back in subsequent calls for consistent pagination.
   */
  expandSearch = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const { originalLocationContext, expandedRadiusKm, page, limit } = req.body as {
        originalLocationContext: BrowseLocationContext;
        expandedRadiusKm: number;
        page: number;
        limit?: number;
      };

      if (!originalLocationContext) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: "originalLocationContext is required",
        });
        return;
      }

      if (!expandedRadiusKm || typeof expandedRadiusKm !== "number" || expandedRadiusKm <= 0) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: "expandedRadiusKm must be a positive number",
        });
        return;
      }

      if (!page || typeof page !== "number" || page < 1) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: "page must be a positive integer",
        });
        return;
      }

      const result = await serviceRequestService.expandSearch({
        originalLocationContext,
        expandedRadiusKm,
        page,
        limit: limit ?? 20,
      });

      res.status(200).json({
        success: true,
        message: `Found ${result.totalResults} service(s) within ${result.locationContext.expandedRadiusKm} km`,
        ...result,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("must be greater than")) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          error: error.message,
        });
        return;
      }
      handleError(res, error, "Failed to expand service search");
    }
  };
}