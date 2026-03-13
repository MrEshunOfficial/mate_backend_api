// controllers/profiles/client/handlers/location.handler.ts
import { Response } from "express";
import { AuthenticatedRequest } from "../../../../types/user.types";
import { getParam } from "../../../../utils/auth/auth.controller.utils";
import { LocationEnrichmentInput } from "../../../../service/location.service";
import { clientProfileService, sendSuccess, handleServiceError, sendError, parsePagination } from "./base.handler";


export class ClientLocationHandler {

  // ─── Saved Addresses ────────────────────────────────────────────────────────

  /**
   * GET /clients/:profileId/addresses/default
   *
   * Returns the client's current default saved address, or null if none exists.
   * Convenience endpoint used by the booking flow to pre-fill the service location.
   */
  getDefaultAddress = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);

      const address = await clientProfileService.getDefaultAddress(profileId);

      sendSuccess(
        res,
        address
          ? "Default address retrieved successfully"
          : "No default address set",
        { address }
      );
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * POST /clients/:profileId/addresses
   *
   * Enriches and appends a new address to savedAddresses.
   *
   * The caller supplies a Ghana Post GPS code (required) plus optional fields.
   * LocationService resolves region, city, district, coordinates, etc. from
   * OpenStreetMap and stamps them onto the new address sub-document.
   *
   * Response includes a missingFields array so the frontend can surface a
   * non-blocking warning when OSM couldn't fully resolve the address.
   *
   * Body:
   * {
   *   "ghanaPostGPS": "GA-123-4567",
   *   "label": "Home",
   *   "nearbyLandmark": "Near Accra Mall",
   *   "gpsCoordinates": { "latitude": 5.6037, "longitude": -0.1870 }
   * }
   */
  addSavedAddress = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);
      const { ghanaPostGPS, nearbyLandmark, gpsCoordinates, label } = req.body;

      if (!ghanaPostGPS?.trim()) {
        sendError(res, 400, "ghanaPostGPS is required");
        return;
      }

      const input: LocationEnrichmentInput & { label?: string } = {
        ghanaPostGPS: ghanaPostGPS.trim(),
        ...(nearbyLandmark && { nearbyLandmark: nearbyLandmark.trim() }),
        ...(gpsCoordinates && { gpsCoordinates }),
        ...(label && { label: label.trim() }),
      };

      const { profile, missingFields } =
        await clientProfileService.addSavedAddress(profileId, input);

      const hasWarnings = missingFields.length > 0;

      sendSuccess(
        res,
        hasWarnings
          ? "Address added. Some fields could not be resolved — see missingFields."
          : "Address added successfully",
        {
          clientProfile: profile,
          ...(hasWarnings && { missingFields }),
        },
        201
      );
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * PUT /clients/:profileId/addresses/:addressId
   *
   * Re-enriches and updates a specific saved address by its sub-document _id.
   * All OSM-derived fields (region, city, coordinates, etc.) are refreshed from
   * the updated Ghana Post GPS code.
   *
   * Body: same shape as addSavedAddress.
   */
  updateSavedAddress = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);
      const addressId = getParam(req.params.addressId);
      const { ghanaPostGPS, nearbyLandmark, gpsCoordinates, label } = req.body;

      if (!ghanaPostGPS?.trim()) {
        sendError(res, 400, "ghanaPostGPS is required");
        return;
      }

      const input: LocationEnrichmentInput & { label?: string } = {
        ghanaPostGPS: ghanaPostGPS.trim(),
        ...(nearbyLandmark && { nearbyLandmark: nearbyLandmark.trim() }),
        ...(gpsCoordinates && { gpsCoordinates }),
        ...(label !== undefined && { label: label.trim() }),
      };

      const { profile, missingFields } =
        await clientProfileService.updateSavedAddress(profileId, addressId, input);

      const hasWarnings = missingFields.length > 0;

      sendSuccess(
        res,
        hasWarnings
          ? "Address updated. Some fields could not be resolved — see missingFields."
          : "Address updated successfully",
        {
          clientProfile: profile,
          ...(hasWarnings && { missingFields }),
        }
      );
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * DELETE /clients/:profileId/addresses/:addressId
   *
   * Removes a saved address by its sub-document _id.
   *
   * If the removed address was the default, defaultAddressIndex is automatically
   * reset to 0 (the new first address). If savedAddresses is now empty it is
   * set to −1 to indicate no default is configured.
   */
  removeSavedAddress = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);
      const addressId = getParam(req.params.addressId);

      const updated = await clientProfileService.removeSavedAddress(
        profileId,
        addressId
      );

      sendSuccess(res, "Address removed successfully", {
        clientProfile: updated,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * PUT /clients/:profileId/addresses/default
   *
   * Sets the default address by index within the savedAddresses array.
   * The index must be within bounds — validated before write.
   *
   * Body: { "index": 1 }
   *
   * Note: declared before /:addressId in the router to avoid collision.
   */
  setDefaultAddress = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);
      const { index } = req.body;

      if (index === undefined || index === null) {
        sendError(res, 400, "index is required");
        return;
      }

      const parsedIndex = parseInt(index, 10);
      if (isNaN(parsedIndex) || parsedIndex < 0) {
        sendError(res, 400, "index must be a non-negative integer");
        return;
      }

      const updated = await clientProfileService.setDefaultAddress(
        profileId,
        parsedIndex
      );

      sendSuccess(res, `Default address set to index ${parsedIndex}`, {
        clientProfile: updated,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  // ─── Providers Near Client ──────────────────────────────────────────────────

  /**
   * GET /clients/:profileId/nearby-providers
   *
   * Returns providers near the client's default (or specified) saved address,
   * sorted nearest-first with distanceKm attached to each result.
   *
   * This is the primary client-facing provider discovery endpoint —
   * "show me providers near my home address".
   *
   * Query params:
   *   addressIndex      — which saved address to use (default: defaultAddressIndex)
   *   radiusKm          — search radius in km (default: 20)
   *   serviceId         — only providers offering this service
   *   isAlwaysAvailable — "true" | "false"
   *   limit             — max results (default: 20, cap: 100)
   */
  getProvidersNearClient = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);
      const { limit } = parsePagination(req.query);

      const {
        addressIndex,
        radiusKm,
        serviceId,
        isAlwaysAvailable,
      } = req.query as Record<string, string | undefined>;

      // Parse and validate optional addressIndex
      let parsedAddressIndex: number | undefined;
      if (addressIndex !== undefined) {
        parsedAddressIndex = parseInt(addressIndex, 10);
        if (isNaN(parsedAddressIndex) || parsedAddressIndex < 0) {
          sendError(res, 400, "addressIndex must be a non-negative integer");
          return;
        }
      }

      // Parse and validate optional radiusKm
      let parsedRadius: number | undefined;
      if (radiusKm !== undefined) {
        parsedRadius = parseFloat(radiusKm);
        if (isNaN(parsedRadius) || parsedRadius <= 0) {
          sendError(res, 400, "radiusKm must be a positive number");
          return;
        }
      }

      const result = await clientProfileService.getProvidersNearClient(
        profileId,
        {
          ...(parsedAddressIndex !== undefined && {
            addressIndex: parsedAddressIndex,
          }),
          ...(parsedRadius !== undefined && { radiusKm: parsedRadius }),
          filters: {
            ...(serviceId?.trim() && { serviceId: serviceId.trim() }),
            ...(isAlwaysAvailable !== undefined && {
              isAlwaysAvailable: isAlwaysAvailable === "true",
            }),
          },
          limit,
        }
      );

      sendSuccess(res, "Nearby providers retrieved successfully", {
        providers: result.providers,
        referenceAddress: result.referenceAddress,
        total: result.total,
        returned: result.providers.length,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };
}