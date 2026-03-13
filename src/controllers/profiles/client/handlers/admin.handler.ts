// controllers/profiles/client/handlers/admin.handler.ts
import { Response } from "express";
import { AuthenticatedRequest } from "../../../../types/user.types";
import { getParam } from "../../../../utils/auth/auth.controller.utils";
import { parsePagination, clientProfileService, sendSuccess, handleServiceError, sendError } from "./base.handler";


export class ClientAdminHandler {

  /**
   * GET /clients/admin/all
   *
   * Paginated list of all client profiles with the parent UserProfile reference
   * populated (userId, role, bio, mobileNumber).
   *
   * Query params:
   *   limit          — default 20, cap 100
   *   skip           — default 0
   *   includeDeleted — "true" includes soft-deleted profiles
   */
  getAllClients = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const { limit, skip } = parsePagination(req.query);
      const includeDeleted = req.query.includeDeleted === "true";

      const result = await clientProfileService.getAllClients(
        { limit, skip },
        includeDeleted
      );

      sendSuccess(res, "All clients retrieved successfully", result);
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * GET /clients/admin/stats
   *
   * Platform-wide or per-client statistics.
   *
   * Query params:
   *   clientId — when supplied, scopes stats to that single client
   *
   * Response:
   * {
   *   totalClients, deletedClients, verifiedClients,
   *   clientsWithAddresses, clientsWithFavorites
   * }
   */
  getClientStats = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const clientId = req.query.clientId as string | undefined;

      const stats = await clientProfileService.getClientStats(
        clientId?.trim() || undefined
      );

      sendSuccess(
        res,
        clientId
          ? "Client stats retrieved successfully"
          : "Platform client stats retrieved successfully",
        { stats }
      );
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * GET /clients/admin/ref/:userProfileId
   *
   * Looks up a ClientProfile by its parent UserProfile._id.
   * Useful for cross-service lookups where only the UserProfile ID is known.
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

  /**
   * PUT /clients/admin/:profileId/verify
   *
   * Admin action: marks the client as verified (KYC or phone verification).
   * Stamps isVerified = true and persists the verificationDetails block.
   *
   * Body:
   * {
   *   "phoneVerified": true,
   *   "emailVerified": true,
   *   "idVerified": false,
   *   "verifiedAt": "2025-01-01T00:00:00.000Z"
   * }
   */
  verifyClient = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);
      const verifiedBy = req.userId!;
      const verificationDetails = req.body;

      if (!verificationDetails || Object.keys(verificationDetails).length === 0) {
        sendError(res, 400, "verificationDetails payload cannot be empty");
        return;
      }

      const updated = await clientProfileService.verifyClient(
        profileId,
        verificationDetails,
        verifiedBy
      );

      sendSuccess(res, "Client verified successfully", {
        clientProfile: updated,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * DELETE /clients/admin/:profileId
   *
   * Admin soft-delete. Marks the profile as isDeleted: true. The document is
   * retained for audit purposes.
   */
  adminDeleteClient = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);
      const deletedBy = req.userId!;

      await clientProfileService.deleteClientProfile(profileId, deletedBy);

      sendSuccess(res, "Client profile soft-deleted successfully");
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * POST /clients/admin/:profileId/restore
   * Restores a soft-deleted client profile.
   */
  adminRestoreClient = async (
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