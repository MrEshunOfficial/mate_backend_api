// controllers/profiles/client/handlers/crud.handler.ts
import { Response } from "express";
import { AuthenticatedRequest } from "../../../../types/user.types";
import { getParam } from "../../../../utils/auth/auth.controller.utils";
import { clientProfileService, sendError, sendSuccess, handleServiceError } from "./base.handler";


export class ClientCRUDHandler {

  // ─── Read ───────────────────────────────────────────────────────────────────

  /**
   * GET /clients/:profileId
   *
   * Public-facing profile read.
   * Pass ?populate=true to load favoriteServices and favoriteProviders.
   */
  getClientProfileById = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);
      const populate = req.query.populate === "true";

      const profile = await clientProfileService.getClientProfileById(
        profileId,
        populate
      );

      if (!profile) {
        sendError(res, 404, "Client profile not found");
        return;
      }

      sendSuccess(res, "Client profile retrieved successfully", {
        clientProfile: profile,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * GET /clients/me
   *
   * Customer-authenticated. Returns the calling client's full profile
   * resolved via their UserProfile._id (attached by role middleware).
   * Always populated — the owner always sees the full document.
   */
  getMyClientProfile = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const userProfileId = (req as any).userProfileId as string | undefined;

      if (!userProfileId) {
        sendError(res, 400, "Profile reference not found on request");
        return;
      }

      const profile =
        await clientProfileService.getClientProfileByProfileRef(
          userProfileId,
          true // owner always gets the full document
        );

      if (!profile) {
        sendError(res, 404, "Client profile not found for this account");
        return;
      }

      sendSuccess(res, "Your client profile retrieved successfully", {
        clientProfile: profile,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * GET /clients/ref/:userProfileId
   *
   * Internal / admin. Looks up a ClientProfile by its parent UserProfile _id.
   */
  getClientProfileByRef = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const userProfileId = getParam(req.params.userProfileId);
      const populate = req.query.populate === "true";

      const profile =
        await clientProfileService.getClientProfileByProfileRef(
          userProfileId,
          populate
        );

      if (!profile) {
        sendError(
          res,
          404,
          "Client profile not found for the given user profile"
        );
        return;
      }

      sendSuccess(res, "Client profile retrieved successfully", {
        clientProfile: profile,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  // ─── General Update ─────────────────────────────────────────────────────────

  /**
   * PUT /clients/:profileId
   *
   * General-purpose field update. Immutable fields (profile ref, soft-delete
   * flags) are stripped before the write. For contact info, personal info, and
   * addresses, use the dedicated endpoints — they run validation and enrichment
   * this method skips.
   */
  updateClientProfile = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);
      const updatedBy = req.userId!;

      if (!req.body || Object.keys(req.body).length === 0) {
        sendError(res, 400, "Request body cannot be empty");
        return;
      }

      const updated = await clientProfileService.updateClientProfile(
        profileId,
        req.body,
        updatedBy
      );

      sendSuccess(res, "Client profile updated successfully", {
        clientProfile: updated,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  // ─── Isolated Onboarding Updates ───────────────────────────────────────────

  /**
   * PUT /clients/:profileId/contact
   *
   * Replaces clientContactInfo as a unit.
   * primaryContact is validated for non-empty string.
   */
  updateContactInfo = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);

      if (!req.body || Object.keys(req.body).length === 0) {
        sendError(res, 400, "Contact info payload cannot be empty");
        return;
      }

      const updated = await clientProfileService.updateContactInfo(
        profileId,
        req.body
      );

      sendSuccess(res, "Contact info updated successfully", {
        clientProfile: updated,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * PUT /clients/:profileId/personal
   *
   * Updates non-sensitive personal info: preferredName and/or dateOfBirth.
   */
  updatePersonalInfo = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);
      const { preferredName, dateOfBirth } = req.body;

      if (preferredName === undefined && dateOfBirth === undefined) {
        sendError(
          res,
          400,
          "Provide at least one of: preferredName, dateOfBirth"
        );
        return;
      }

      const updated = await clientProfileService.updatePersonalInfo(
        profileId,
        {
          ...(preferredName !== undefined && { preferredName }),
          ...(dateOfBirth !== undefined && {
            dateOfBirth: new Date(dateOfBirth),
          }),
        }
      );

      sendSuccess(res, "Personal info updated successfully", {
        clientProfile: updated,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  // ─── Profile Completeness ───────────────────────────────────────────────────

  /**
   * GET /clients/:profileId/profile-status
   *
   * Returns isReady and missingFields for the onboarding checklist UI.
   * A client must have a primary contact and at least one saved address
   * before they can book a service.
   */
  getProfileReadyStatus = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);
      const status = await clientProfileService.isProfileReady(profileId);

      sendSuccess(res, "Profile status retrieved successfully", status);
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  // ─── ID Document Images ─────────────────────────────────────────────────────

  /**
   * POST /clients/:profileId/id-images
   *
   * Attaches government ID document images to idDetails.fileImageId[].
   * idDetails metadata (type, number) must already exist — set it via
   * PUT /clients/:profileId first.
   *
   * Body: { "fileIds": ["<objectId>", …] }
   */
  updateIdImages = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);
      const uploadedBy = req.userId!;
      const { fileIds } = req.body;

      if (!Array.isArray(fileIds) || fileIds.length === 0) {
        sendError(res, 400, "fileIds must be a non-empty array");
        return;
      }

      const { Types } = await import("mongoose");

      const invalidIds = fileIds.filter(
        (id: unknown) => typeof id !== "string" || !Types.ObjectId.isValid(id)
      );
      if (invalidIds.length > 0) {
        sendError(res, 400, `Invalid file IDs: ${invalidIds.join(", ")}`);
        return;
      }

      const objectIds = fileIds.map(
        (id: string) => new Types.ObjectId(id)
      );

      const updated = await clientProfileService.updateIdImages(
        profileId,
        objectIds,
        uploadedBy
      );

      sendSuccess(res, "ID images uploaded and linked successfully", {
        clientProfile: updated,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * DELETE /clients/:profileId/id-images/:fileId
   *
   * Removes a single ID image from idDetails.fileImageId.
   * Does NOT delete the underlying File document — caller handles cleanup.
   */
  removeIdImage = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);
      const fileId = getParam(req.params.fileId);

      const updated = await clientProfileService.removeIdImage(
        profileId,
        fileId
      );

      sendSuccess(res, "ID image removed successfully", {
        clientProfile: updated,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  // ─── Preferences ────────────────────────────────────────────────────────────

  /**
   * PUT /clients/:profileId/preferences
   *
   * Merges individual preference fields into the existing preferences
   * sub-document. Sending a single field (e.g. languagePreference) does not
   * overwrite the rest — each key is applied via dot-notation $set.
   *
   * Body: { "languagePreference": "en", "communicationPreferences": { … } }
   */
  updatePreferences = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);

      if (!req.body || Object.keys(req.body).length === 0) {
        sendError(res, 400, "Preferences payload cannot be empty");
        return;
      }

      const updated = await clientProfileService.updatePreferences(
        profileId,
        req.body
      );

      sendSuccess(res, "Preferences updated successfully", {
        clientProfile: updated,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  // ─── Soft Delete / Restore ──────────────────────────────────────────────────

  /**
   * DELETE /clients/:profileId
   * Soft-deletes the client profile. Admin-only on the route.
   */
  deleteClientProfile = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);
      const deletedBy = req.userId;

      await clientProfileService.deleteClientProfile(profileId, deletedBy);

      sendSuccess(res, "Client profile deleted successfully");
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * POST /clients/:profileId/restore
   * Restores a soft-deleted client profile. Admin-only.
   */
  restoreClientProfile = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);
      const restored =
        await clientProfileService.restoreClientProfile(profileId);

      sendSuccess(res, "Client profile restored successfully", {
        clientProfile: restored,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };
}