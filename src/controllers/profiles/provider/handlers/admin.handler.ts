// controllers/profiles/provider/handlers/admin.handler.ts
import { Response } from "express";
import { AuthenticatedRequest } from "../../../../types/user.types";
import { getParam } from "../../../../utils/auth/auth.controller.utils";
import { parsePagination, providerProfileService, sendSuccess, handleServiceError, sendError } from "./base.handler";


export class ProviderAdminHandler {

  /**
   * GET /providers/admin/all
   *
   * Paginated list of all provider profiles with full population (UserProfile
   * ref, serviceOfferings, etc.).
   *
   * Query params:
   *   limit          — default 20, cap 100
   *   skip           — default 0
   *   includeDeleted — "true" includes soft-deleted profiles
   */
  getAllProviders = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const { limit, skip } = parsePagination(req.query);
      const includeDeleted = req.query.includeDeleted === "true";

      const result = await providerProfileService.getAllProviders(
        { limit, skip },
        includeDeleted
      );

      sendSuccess(res, "All providers retrieved successfully", result);
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * PUT /providers/admin/:profileId/verify-address
   *
   * Stamps isAddressVerified = true on the provider's locationData.
   *
   * Before writing, re-runs LocationService.verifyStoredLocation() and logs
   * any discrepancies. Discrepancies are non-blocking — the admin's decision
   * takes precedence over what OSM returns.
   *
   * Requires the provider to have locationData.ghanaPostGPS set.
   */
  verifyProviderAddress = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);
      const verifiedBy = req.userId!;

      const updated = await providerProfileService.verifyProviderAddress(
        profileId,
        verifiedBy
      );

      sendSuccess(res, "Provider address verified successfully", {
        providerProfile: updated,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * PUT /providers/admin/:profileId/company-trained
   *
   * Sets or clears the isCompanyTrained flag.
   *
   * Body: { "isCompanyTrained": true }
   */
  setCompanyTrained = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);
      const { isCompanyTrained } = req.body;
      const updatedBy = req.userId!;

      if (typeof isCompanyTrained !== "boolean") {
        sendError(res, 400, "isCompanyTrained (boolean) is required");
        return;
      }

      const updated = await providerProfileService.setCompanyTrained(
        profileId,
        isCompanyTrained,
        updatedBy
      );

      sendSuccess(
        res,
        `Company training status set to ${isCompanyTrained}`,
        { providerProfile: updated }
      );
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * GET /providers/admin/stats
   *
   * Platform-wide or per-provider statistics.
   *
   * Query params:
   *   providerId — when supplied, scopes stats to that single provider
   *
   * Note: liveReadyProviders is a DB approximation — it excludes the
   * availability rule because workingHours uses Mixed/strict:false which is
   * unreliable to query. Always call isProfileLive() for an authoritative check.
   */
  getProviderStats = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const providerId = req.query.providerId as string | undefined;

      const stats = await providerProfileService.getProviderStats(
        providerId?.trim() || undefined
      );

      sendSuccess(
        res,
        providerId
          ? "Provider stats retrieved successfully"
          : "Platform provider stats retrieved successfully",
        { stats }
      );
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * DELETE /providers/admin/:profileId
   *
   * Admin soft-delete. Marks the profile as isDeleted: true. The document is
   * retained for audit purposes. Prefer role transition over direct delete for
   * provider → customer switches.
   */
  adminDeleteProvider = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);
      const deletedBy = req.userId!;

      await providerProfileService.deleteProviderProfile(profileId, deletedBy);

      sendSuccess(res, "Provider profile soft-deleted successfully");
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * POST /providers/admin/:profileId/restore
   * Restores a soft-deleted provider profile.
   */
  adminRestoreProvider = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);
      const restored =
        await providerProfileService.restoreProviderProfile(profileId);

      sendSuccess(res, "Provider profile restored successfully", {
        providerProfile: restored,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * POST /providers/admin/:profileId/services/:serviceId
   *
   * Admin: force-links a service to this provider's profile.
   * Bypasses the ownership guard — use when a service was created with the
   * wrong providerId and needs manual repair.
   */
  adminAddServiceOffering = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);
      const serviceId = getParam(req.params.serviceId);

      const updated = await providerProfileService.addServiceOffering(
        profileId,
        serviceId
      );

      sendSuccess(
        res,
        "Service linked to provider profile (admin override)",
        { providerProfile: updated }
      );
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * DELETE /providers/admin/:profileId/services/:serviceId
   * Admin: force-unlinks a service from this provider's profile.
   */
  adminRemoveServiceOffering = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);
      const serviceId = getParam(req.params.serviceId);

      const updated = await providerProfileService.removeServiceOffering(
        profileId,
        serviceId
      );

      sendSuccess(
        res,
        "Service unlinked from provider profile (admin)",
        { providerProfile: updated }
      );
    } catch (error) {
      handleServiceError(res, error);
    }
  };
}