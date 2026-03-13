// controllers/profiles/provider/handlers/location.handler.ts
import { Response } from "express";
import { AuthenticatedRequest } from "../../../../types/user.types";
import { getParam } from "../../../../utils/auth/auth.controller.utils";
import { LocationEnrichmentInput } from "../../../../service/location.service";
import { sendError, providerProfileService, sendSuccess, handleServiceError } from "./base.handler";

export class ProviderLocationHandler {

  /**
   * PUT /providers/:profileId/location
   *
   * Enriches and persists the provider's location data.
   *
   * The caller supplies only the Ghana Post GPS code (required) plus optional
   * fields. LocationService resolves region, city, district, coordinates, etc.
   * from OpenStreetMap and stamps them onto the document.
   *
   * Body:
   * {
   *   "ghanaPostGPS": "GA-123-4567",
   *   "nearbyLandmark": "Near Accra Mall",
   *   "gpsCoordinates": { "latitude": 5.6037, "longitude": -0.1870 }
   * }
   *
   * Response includes a missingFields array so the frontend can surface a
   * non-blocking warning when OSM couldn't resolve the full address.
   * The location is saved regardless.
   */
  updateLocationData = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);
      const { ghanaPostGPS, nearbyLandmark, gpsCoordinates } = req.body;

      if (!ghanaPostGPS?.trim()) {
        sendError(res, 400, "ghanaPostGPS is required");
        return;
      }

      const input: LocationEnrichmentInput = {
        ghanaPostGPS: ghanaPostGPS.trim(),
        ...(nearbyLandmark && { nearbyLandmark: nearbyLandmark.trim() }),
        ...(gpsCoordinates && { gpsCoordinates }),
      };

      const { profile, missingFields } =
        await providerProfileService.updateLocationData(profileId, input);

      const hasWarnings = missingFields.length > 0;

      sendSuccess(
        res,
        hasWarnings
          ? "Location updated. Some fields could not be resolved — see missingFields."
          : "Location updated successfully",
        {
          providerProfile: profile,
          ...(hasWarnings && { missingFields }),
        }
      );
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * POST /providers/:profileId/location/verify
   *
   * Re-runs LocationService.verifyStoredLocation() against the stored address
   * and returns the verification result.
   *
   * This is the provider's self-service check — it does NOT stamp
   * isAddressVerified. Only the admin endpoint (admin.handler.ts) writes
   * that flag after a human has confirmed the address is correct.
   *
   * Returns:
   * { verified: true,  discrepancies: [] }
   * { verified: false, discrepancies: ["city", "district"] }
   */
  checkLocationVerification = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);

      const profile =
        await providerProfileService.getProviderProfileById(profileId);

      if (!profile) {
        sendError(res, 404, "Provider profile not found");
        return;
      }

      if (!profile.locationData?.ghanaPostGPS) {
        sendError(
          res,
          400,
          "No location data found — submit a Ghana Post GPS code first"
        );
        return;
      }

      // Import the shared singleton for the read-only verification check.
      // The write path (stamping isAddressVerified) lives in admin.handler.ts
      // via ProviderProfileService.verifyProviderAddress().
      const { locationService } = await import(
        "../../../../service/location.service"
      );

      const verification = await locationService.verifyStoredLocation(
        profile.locationData
      );

      sendSuccess(res, "Location verification check completed", {
        verified: verification.verified,
        discrepancies: verification.discrepancies,
        locationData: profile.locationData,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };
}