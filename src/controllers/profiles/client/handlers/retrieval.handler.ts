// controllers/profiles/client/handlers/retrieval.handler.ts
import { Response } from "express";
import { AuthenticatedRequest } from "../../../../types/user.types";
import { getParam } from "../../../../utils/auth/auth.controller.utils";
import { Coordinates } from "../../../../types/location.types";
import { clientProfileService, sendSuccess, handleServiceError, sendError } from "./base.handler";

export class ClientRetrievalHandler {

  // ─── Favourite Services ─────────────────────────────────────────────────────

  /**
   * GET /clients/:profileId/favorites/services
   *
   * Returns the client's favourite services, populated with title, slug,
   * pricing, and cover image. Only active, non-deleted services are returned.
   */
  getFavoriteServices = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);

      const services =
        await clientProfileService.getFavoriteServices(profileId);

      sendSuccess(res, "Favourite services retrieved successfully", {
        services,
        total: services.length,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * POST /clients/:profileId/favorites/services/:serviceId
   *
   * Adds a service to the client's favourites list.
   * $addToSet ensures idempotency — adding the same service twice is safe.
   * Verifies the service exists before writing.
   */
  addFavoriteService = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);
      const serviceId = getParam(req.params.serviceId);

      const updated = await clientProfileService.addFavoriteService(
        profileId,
        serviceId
      );

      sendSuccess(res, "Service added to favourites successfully", {
        clientProfile: updated,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * DELETE /clients/:profileId/favorites/services/:serviceId
   * Removes a service from the client's favourites list.
   */
  removeFavoriteService = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);
      const serviceId = getParam(req.params.serviceId);

      const updated = await clientProfileService.removeFavoriteService(
        profileId,
        serviceId
      );

      sendSuccess(res, "Service removed from favourites successfully", {
        clientProfile: updated,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  // ─── Favourite Providers ────────────────────────────────────────────────────

  /**
   * GET /clients/:profileId/favorites/providers
   *
   * Returns the client's favourite providers, populated with business info,
   * location, and service offerings.
   *
   * Pass ?fromLat + ?fromLng to receive distance-annotated results sorted
   * nearest-first. Omit them for unsorted results.
   *
   * Query params:
   *   fromLat / fromLng — reference coordinates for distance annotation + sort
   */
  getFavoriteProviders = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);
      const { fromLat, fromLng } = req.query as Record<
        string,
        string | undefined
      >;

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

      const providers = await clientProfileService.getFavoriteProviders(
        profileId,
        from
      );

      sendSuccess(res, "Favourite providers retrieved successfully", {
        providers,
        total: (providers as any[]).length,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * POST /clients/:profileId/favorites/providers/:providerProfileId
   *
   * Adds a provider to the client's favourites list.
   * $addToSet ensures idempotency. Verifies the provider exists before writing.
   */
  addFavoriteProvider = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);
      const providerProfileId = getParam(req.params.providerProfileId);

      const updated = await clientProfileService.addFavoriteProvider(
        profileId,
        providerProfileId
      );

      sendSuccess(res, "Provider added to favourites successfully", {
        clientProfile: updated,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * DELETE /clients/:profileId/favorites/providers/:providerProfileId
   * Removes a provider from the client's favourites list.
   */
  removeFavoriteProvider = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);
      const providerProfileId = getParam(req.params.providerProfileId);

      const updated = await clientProfileService.removeFavoriteProvider(
        profileId,
        providerProfileId
      );

      sendSuccess(res, "Provider removed from favourites successfully", {
        clientProfile: updated,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };
}