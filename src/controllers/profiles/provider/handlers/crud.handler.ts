// controllers/profiles/provider/handlers/crud.handler.ts
import { Response } from "express";
import { AuthenticatedRequest } from "../../../../types/user.types";
import { getParam } from "../../../../utils/auth/auth.controller.utils";
import {
  providerProfileService,
  sendError,
  sendSuccess,
  handleServiceError,
} from "./base.handler";

export class ProviderCRUDHandler {
  // ─── Read ───────────────────────────────────────────────────────────────────

  /**
   * GET /providers/:profileId
   *
   * Public — returns the provider's profile.
   * Pass ?populate=true for populated sub-documents (serviceOfferings, gallery,
   * ID details). Useful for the owner's own dashboard view.
   */
  getProviderProfileById = async (
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);
      const populate = req.query.populate === "true";

      const profile = await providerProfileService.getProviderProfileById(
        profileId,
        populate,
      );

      if (!profile) {
        sendError(res, 404, "Provider profile not found");
        return;
      }

      sendSuccess(res, "Provider profile retrieved successfully", {
        providerProfile: profile,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * GET /providers/me
   *
   * Provider-authenticated. Returns the calling provider's full profile
   * resolved via their UserProfile._id (attached by role middleware).
   * Always populated — the owner always sees the full document.
   */
  getMyProviderProfile = async (
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> => {
    try {
      const userProfileId = (req as any).userProfileId as string | undefined;

      if (!userProfileId) {
        sendError(res, 400, "Profile reference not found on request");
        return;
      }

      const profile =
        await providerProfileService.getProviderProfileByProfileRef(
          userProfileId,
          true, // owner always gets the full document
        );

      if (!profile) {
        sendError(res, 404, "Provider profile not found for this account");
        return;
      }

      sendSuccess(res, "Your provider profile retrieved successfully", {
        providerProfile: profile,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * GET /providers/ref/:userProfileId
   *
   * Internal / admin. Looks up a ProviderProfile by its parent UserProfile _id.
   * Useful for cross-service lookups where only the UserProfile ID is available.
   */
  getProviderProfileByRef = async (
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> => {
    try {
      const userProfileId = getParam(req.params.userProfileId);
      const populate = req.query.populate === "true";

      const profile =
        await providerProfileService.getProviderProfileByProfileRef(
          userProfileId,
          populate,
        );

      if (!profile) {
        sendError(
          res,
          404,
          "Provider profile not found for the given user profile",
        );
        return;
      }

      sendSuccess(res, "Provider profile retrieved successfully", {
        providerProfile: profile,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  // ─── General Update ─────────────────────────────────────────────────────────

  /**
   * PUT /providers/:profileId
   *
   * General-purpose field update. For structured sub-documents (contact info,
   * location, working hours, availability, deposit settings), use the dedicated
   * endpoints — they run validation and enrichment this method skips.
   */
  updateProviderProfile = async (
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);
      const updatedBy = req.userId!;

      if (!req.body || Object.keys(req.body).length === 0) {
        sendError(res, 400, "Request body cannot be empty");
        return;
      }

      const updated = await providerProfileService.updateProviderProfile(
        profileId,
        req.body,
        updatedBy,
      );

      sendSuccess(res, "Provider profile updated successfully", {
        providerProfile: updated,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  // ─── Isolated Onboarding Updates ───────────────────────────────────────────

  /**
   * PUT /providers/:profileId/contact
   * Replaces providerContactInfo as a unit.
   * primaryContact is validated for non-empty string.
   */
  updateContactInfo = async (
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);

      if (!req.body || Object.keys(req.body).length === 0) {
        sendError(res, 400, "Contact info payload cannot be empty");
        return;
      }
      const contactData = req.body.providerContactInfo ?? req.body;

      const updated = await providerProfileService.updateContactInfo(
        profileId,
        contactData,
      );

      sendSuccess(res, "Contact info updated successfully", {
        providerProfile: updated,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * PUT /providers/:profileId/business
   * Updates businessName, idDetails (metadata only — not images), and
   * isCompanyTrained. ID images are managed via /id-images.
   */
  updateBusinessInfo = async (
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);
      const { businessName, idDetails, isCompanyTrained } = req.body;

      if (
        businessName === undefined &&
        idDetails === undefined &&
        isCompanyTrained === undefined
      ) {
        sendError(
          res,
          400,
          "Provide at least one of: businessName, idDetails, isCompanyTrained",
        );
        return;
      }

      const updated = await providerProfileService.updateBusinessInfo(
        profileId,
        {
          ...(businessName !== undefined && { businessName }),
          ...(idDetails !== undefined && { idDetails }),
          ...(isCompanyTrained !== undefined && { isCompanyTrained }),
        },
      );

      sendSuccess(res, "Business info updated successfully", {
        providerProfile: updated,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * PUT /providers/:profileId/working-hours
   * Replaces the entire working hours map.
   * Always sets isAlwaysAvailable: false.
   *
   * Body: { workingHours: { monday: { start: "09:00", end: "17:00" }, … } }
   */
  updateWorkingHours = async (
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);
      const { workingHours } = req.body;

      if (!workingHours || typeof workingHours !== "object") {
        sendError(res, 400, "workingHours object is required");
        return;
      }

      const updated = await providerProfileService.updateWorkingHours(
        profileId,
        workingHours,
      );

      sendSuccess(res, "Working hours updated successfully", {
        providerProfile: updated,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * PUT /providers/:profileId/availability
   * Sets availability mode.
   *
   * Body (always available):  { isAlwaysAvailable: true }
   * Body (specific hours):    { isAlwaysAvailable: false, workingHours: { … } }
   *
   * When isAlwaysAvailable is true, existing workingHours are cleared.
   * When false, workingHours are required and validated.
   */
  setAvailability = async (
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);
      const { isAlwaysAvailable, workingHours } = req.body;

      if (typeof isAlwaysAvailable !== "boolean") {
        sendError(res, 400, "isAlwaysAvailable (boolean) is required");
        return;
      }

      const updated = await providerProfileService.setAvailability(
        profileId,
        isAlwaysAvailable,
        workingHours,
      );

      sendSuccess(
        res,
        isAlwaysAvailable
          ? "Provider set to always available"
          : "Working hours set as availability schedule",
        { providerProfile: updated },
      );
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * PUT /providers/:profileId/deposit-settings
   * Updates the deposit configuration as a unit.
   *
   * Body: { requireInitialDeposit: true, percentageDeposit: 30 }
   * Body: { requireInitialDeposit: false }  ← clears percentageDeposit
   */
  updateDepositSettings = async (
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);
      const { requireInitialDeposit, percentageDeposit } = req.body;

      if (typeof requireInitialDeposit !== "boolean") {
        sendError(res, 400, "requireInitialDeposit (boolean) is required");
        return;
      }

      const updated = await providerProfileService.updateDepositSettings(
        profileId,
        requireInitialDeposit,
        percentageDeposit,
      );

      sendSuccess(res, "Deposit settings updated successfully", {
        providerProfile: updated,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  // ─── Profile Completeness ───────────────────────────────────────────────────

  /**
   * GET /providers/:profileId/profile-status
   * Returns isLive and missingFields for the onboarding checklist UI.
   */
  getProfileLiveStatus = async (
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);
      const status = await providerProfileService.isProfileLive(profileId);

      sendSuccess(res, "Profile status retrieved successfully", status);
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  // ─── Soft Delete / Restore ──────────────────────────────────────────────────

  /**
   * DELETE /providers/:profileId
   * Soft-deletes the provider profile.
   * Used by admins — providers deactivate via role transition, not direct delete.
   */
  deleteProviderProfile = async (
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);
      const deletedBy = req.userId;

      await providerProfileService.deleteProviderProfile(profileId, deletedBy);

      sendSuccess(res, "Provider profile deleted successfully");
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * POST /providers/:profileId/restore
   * Restores a soft-deleted provider profile. Admin-only.
   */
  restoreProviderProfile = async (
    req: AuthenticatedRequest,
    res: Response,
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
}
