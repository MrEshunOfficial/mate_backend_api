// controllers/profiles/provider/handlers/search.handler.ts
import { Response } from "express";
import { AuthenticatedRequest } from "../../../../types/user.types";
import { getParam } from "../../../../utils/auth/auth.controller.utils";
import { Coordinates } from "../../../../types/location.types";
import { parsePagination, sendError, providerProfileService, sendSuccess, handleServiceError } from "./base.handler";

export class ProviderSearchHandler {

  /**
   * GET /providers/search
   *
   * Multi-filter provider search. Supports region, city, service, availability,
   * business name text search, and optional distance annotation.
   *
   * Query params:
   *   region            — exact match on locationData.region
   *   city              — exact match on locationData.city
   *   serviceId         — providers offering this service
   *   searchTerm        — full-text search on businessName index
   *   isAlwaysAvailable — "true" | "false"
   *   fromLat / fromLng — reference coordinates for distance annotation + sort
   *   limit / skip      — pagination (default 20 / 0, cap 100)
   *
   * When fromLat + fromLng are supplied, results are annotated with distanceKm
   * and sorted nearest-first. Without coordinates results sort by createdAt desc.
   */
  searchProviders = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const { limit, skip } = parsePagination(req.query);
      const {
        region,
        city,
        serviceId,
        searchTerm,
        isAlwaysAvailable,
        fromLat,
        fromLng,
      } = req.query as Record<string, string | undefined>;

      // Build optional reference coordinates for distance annotation
      let from: Coordinates | undefined;
      if (fromLat && fromLng) {
        const lat = parseFloat(fromLat);
        const lng = parseFloat(fromLng);
        if (
          isNaN(lat) || isNaN(lng) ||
          lat < -90 || lat > 90 ||
          lng < -180 || lng > 180
        ) {
          sendError(
            res,
            400,
            "fromLat must be −90..90 and fromLng must be −180..180"
          );
          return;
        }
        from = { latitude: lat, longitude: lng };
      }

      const filters: Parameters<
        typeof providerProfileService.searchProviders
      >[0] = {
        ...(region?.trim() && { region: region.trim() }),
        ...(city?.trim() && { city: city.trim() }),
        ...(serviceId?.trim() && { serviceId: serviceId.trim() }),
        ...(searchTerm?.trim() && { searchTerm: searchTerm.trim() }),
        ...(isAlwaysAvailable !== undefined && {
          isAlwaysAvailable: isAlwaysAvailable === "true",
        }),
        ...(from && { from }),
      };

      const result = await providerProfileService.searchProviders(
        filters,
        limit,
        skip
      );

      sendSuccess(res, "Providers retrieved successfully", {
        ...result,
        appliedFilters: {
          ...filters,
          from: from
            ? { latitude: from.latitude, longitude: from.longitude }
            : undefined,
        },
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * GET /providers/by-location
   *
   * Returns providers filtered by region (required) and optionally city.
   * Simple field-match query — for distance-ordered results use /search
   * with fromLat + fromLng instead.
   *
   * Query params:
   *   region  — required
   *   city    — optional
   */
  getProvidersByLocation = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const { region, city } = req.query as Record<
        string,
        string | undefined
      >;

      if (!region?.trim()) {
        sendError(res, 400, "region query parameter is required");
        return;
      }

      const providers = await providerProfileService.getProvidersByLocation(
        region.trim(),
        city?.trim()
      );

      sendSuccess(res, "Providers retrieved successfully", {
        providers,
        total: providers.length,
        appliedFilters: {
          region: region.trim(),
          ...(city && { city: city.trim() }),
        },
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * GET /providers/near
   *
   * Geospatial proximity search via MongoDB $near operator.
   *
   * ⚠️  Requires the MongoDB 2dsphere index on locationData.gpsCoordinates to
   * be migrated to GeoJSON Point format before going to production. Until then
   * use /search with fromLat + fromLng for Haversine-based results.
   *
   * Query params:
   *   lat       — reference latitude  (required)
   *   lng       — reference longitude (required)
   *   radiusKm  — search radius in km (default: 10)
   *   limit     — max results         (default: 20, cap: 100)
   */
  getProvidersNearCoordinates = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const { lat, lng, radiusKm } = req.query as Record<
        string,
        string | undefined
      >;
      const { limit } = parsePagination(req.query);

      if (!lat || !lng) {
        sendError(res, 400, "lat and lng query parameters are required");
        return;
      }

      const latitude  = parseFloat(lat);
      const longitude = parseFloat(lng);
      const radius    = radiusKm ? parseFloat(radiusKm) : 10;

      if (isNaN(latitude) || isNaN(longitude)) {
        sendError(res, 400, "lat and lng must be valid numbers");
        return;
      }
      if (latitude < -90 || latitude > 90) {
        sendError(res, 400, "lat must be between −90 and 90");
        return;
      }
      if (longitude < -180 || longitude > 180) {
        sendError(res, 400, "lng must be between −180 and 180");
        return;
      }
      if (isNaN(radius) || radius <= 0) {
        sendError(res, 400, "radiusKm must be a positive number");
        return;
      }

      const result = await providerProfileService.getProvidersNearCoordinates(
        latitude,
        longitude,
        radius,
        limit
      );

      sendSuccess(res, "Nearby providers retrieved successfully", {
        ...result,
        referencePoint: { latitude, longitude },
        radiusKm: radius,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * GET /providers/by-service/:serviceId
   *
   * Returns all providers whose serviceOfferings array contains the given
   * service. Useful for the "providers offering this service" panel.
   */
  getProvidersByService = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const serviceId = getParam(req.params.serviceId);

      const providers =
        await providerProfileService.getProvidersByService(serviceId);

      sendSuccess(res, "Providers retrieved successfully", {
        providers,
        total: providers.length,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };
}