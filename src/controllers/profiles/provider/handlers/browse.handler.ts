// controllers/profiles/provider/handlers/browse.handler.ts
//
// Handles GET /providers/browse — the canonical public provider discovery endpoint.
// Add the handler method to your router and controller index following the same
// pattern used by ProviderSearchHandler.

import { Response } from "express";
import { AuthenticatedRequest } from "../../../../types/user.types";
import {
  providerProfileService,
  sendSuccess,
  sendError,
  handleServiceError,
  parsePagination,
} from "./base.handler";
import { Coordinates } from "../../../../types/location.types";
import {
  BrowseSortBy,
  BrowseOrder,
  BrowseProvidersFilters,
  BrowseProvidersOptions,
} from "../../../../service/profiles/provider.profile.service";

export class ProviderBrowseHandler {
  /**
   * GET /providers/browse
   *
   * Unified public provider discovery with full filter + sort surface.
   *
   * Query parameters:
   * ┌─────────────────────┬──────────┬───────────────────────────────────────────┐
   * │ Param               │ Type     │ Notes                                     │
   * ├─────────────────────┼──────────┼───────────────────────────────────────────┤
   * │ q                   │ string   │ Full-text search on businessName           │
   * │ region              │ string   │ Case-insensitive region match              │
   * │ city                │ string   │ Case-insensitive city match                │
   * │ serviceId           │ ObjectId │ Providers offering this service            │
   * │ isAlwaysAvailable   │ boolean  │ "true" filters to always-available         │
   * │ isCompanyTrained    │ boolean  │ "true" filters to certified providers      │
   * │ isAddressVerified   │ boolean  │ "true" filters to verified addresses       │
   * │ lat                 │ number   │ Client latitude  (-90..90)                 │
   * │ lng                 │ number   │ Client longitude (-180..180)               │
   * │ radiusKm            │ number   │ Nearby threshold (default 10, max 200)     │
   * │ sortBy              │ string   │ "distance" | "createdAt" | "businessName"  │
   * │ order               │ string   │ "asc" | "desc"                             │
   * │ page                │ number   │ 1-based page (default 1)                   │
   * │ limit               │ number   │ Per page (default 20, max 100)             │
   * └─────────────────────┴──────────┴───────────────────────────────────────────┘
   *
   * Response shape:
   * {
   *   providers:       ProviderProfile[]  — current page, distanceKm annotated when lat/lng given
   *   nearbyProviders: ProviderProfile[]  — subset of providers within radiusKm (full list, not paged)
   *   total:           number             — total matching records
   *   page:            number
   *   limit:           number
   *   hasMore:         boolean
   *   radiusKm:        number
   *   appliedFilters:  object
   * }
   *
   * Notes:
   * - When sortBy="distance" and lat/lng are present, Haversine sorting is applied
   *   in memory (correct distances, no GeoJSON migration needed).
   * - When lat/lng are absent and sortBy="distance" is requested, the service
   *   automatically falls back to "createdAt" desc.
   * - nearbyProviders always reflects the full nearby set across all pages,
   *   so the frontend can render the "Near You" section count on page 1 and
   *   know how many there are total.
   */
  browseProviders = async (
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> => {
    try {
      const q = req.query as Record<string, string | undefined>;

      // ── Coordinates ──────────────────────────────────────────────────────
      let from: Coordinates | undefined;

      if (q.lat !== undefined || q.lng !== undefined) {
        // Both must be present together
        if (!q.lat || !q.lng) {
          sendError(
            res,
            400,
            "Both lat and lng are required when providing coordinates",
          );
          return;
        }

        const lat = parseFloat(q.lat);
        const lng = parseFloat(q.lng);

        if (isNaN(lat) || isNaN(lng)) {
          sendError(res, 400, "lat and lng must be valid numbers");
          return;
        }
        if (lat < -90 || lat > 90) {
          sendError(res, 400, "lat must be between −90 and 90");
          return;
        }
        if (lng < -180 || lng > 180) {
          sendError(res, 400, "lng must be between −180 and 180");
          return;
        }

        from = { latitude: lat, longitude: lng };
      }

      // ── radiusKm ─────────────────────────────────────────────────────────
      let radiusKm = 10;
      if (q.radiusKm !== undefined) {
        radiusKm = parseFloat(q.radiusKm);
        if (isNaN(radiusKm) || radiusKm <= 0) {
          sendError(res, 400, "radiusKm must be a positive number");
          return;
        }
      }

      // ── sortBy / order ────────────────────────────────────────────────────
      const VALID_SORT_BY: BrowseSortBy[] = [
        "distance",
        "createdAt",
        "businessName",
      ];
      const VALID_ORDER: BrowseOrder[] = ["asc", "desc"];

      let sortBy: BrowseSortBy | undefined;
      if (q.sortBy !== undefined) {
        if (!VALID_SORT_BY.includes(q.sortBy as BrowseSortBy)) {
          sendError(
            res,
            400,
            `sortBy must be one of: ${VALID_SORT_BY.join(", ")}`,
          );
          return;
        }
        sortBy = q.sortBy as BrowseSortBy;
      }

      let order: BrowseOrder | undefined;
      if (q.order !== undefined) {
        if (!VALID_ORDER.includes(q.order as BrowseOrder)) {
          sendError(
            res,
            400,
            `order must be one of: ${VALID_ORDER.join(", ")}`,
          );
          return;
        }
        order = q.order as BrowseOrder;
      }

      // ── Pagination ────────────────────────────────────────────────────────
      const page = Math.max(1, parseInt(q.page ?? "1", 10) || 1);
      const { limit } = parsePagination(req.query);

      // ── Boolean helpers ───────────────────────────────────────────────────
      function parseBool(val?: string): boolean | undefined {
        if (val === "true") return true;
        if (val === "false") return false;
        return undefined;
      }

      // ── Assemble filter + options objects ─────────────────────────────────
      const filters: BrowseProvidersFilters = {
        ...(q.q?.trim() && { q: q.q.trim() }),
        ...(q.region?.trim() && { region: q.region.trim() }),
        ...(q.city?.trim() && { city: q.city.trim() }),
        ...(q.serviceId?.trim() && { serviceId: q.serviceId.trim() }),
        ...(parseBool(q.isAlwaysAvailable) !== undefined && {
          isAlwaysAvailable: parseBool(q.isAlwaysAvailable),
        }),
        ...(parseBool(q.isCompanyTrained) !== undefined && {
          isCompanyTrained: parseBool(q.isCompanyTrained),
        }),
        ...(parseBool(q.isAddressVerified) !== undefined && {
          isAddressVerified: parseBool(q.isAddressVerified),
        }),
        ...(from && { from }),
        radiusKm,
      };

      const options: BrowseProvidersOptions = {
        ...(sortBy && { sortBy }),
        ...(order && { order }),
        page,
        limit,
      };

      const result = await providerProfileService.browseProviders(
        filters,
        options,
      );

      sendSuccess(res, "Providers retrieved successfully", result);
    } catch (error) {
      handleServiceError(res, error);
    }
  };
}
