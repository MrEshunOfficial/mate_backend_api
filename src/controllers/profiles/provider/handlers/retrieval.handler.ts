// controllers/profiles/provider/handlers/retrieval.handler.ts
import { Response } from "express";
import { Types } from "mongoose";
import { AuthenticatedRequest } from "../../../../types/user.types";
import { getParam } from "../../../../utils/auth/auth.controller.utils";
import { providerProfileService, sendSuccess, handleServiceError, sendError } from "./base.handler";


export class ProviderRetrievalHandler {

  // ─── Service Offerings ──────────────────────────────────────────────────────

  /**
   * GET /providers/:profileId/services
   *
   * Returns populated Service documents linked to this provider.
   * Public callers see only active services (default).
   * Owner and admins can pass ?includeInactive=true to see all.
   */
  getServiceOfferings = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);
      const includeInactive = req.query.includeInactive === "true";

      const services = await providerProfileService.getServiceOfferings(
        profileId,
        includeInactive
      );

      sendSuccess(res, "Service offerings retrieved successfully", {
        services,
        total: services.length,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * POST /providers/:profileId/services/:serviceId
   *
   * Links an existing service to this provider's profile.
   * Includes an ownership guard — the service's providerId must match profileId.
   * Intended as a repair/admin utility; the canonical path is
   * ServiceService.createService().
   */
  addServiceOffering = async (
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

      sendSuccess(res, "Service linked to provider profile successfully", {
        providerProfile: updated,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * DELETE /providers/:profileId/services/:serviceId
   *
   * Unlinks a service from this provider's serviceOfferings array.
   * Does NOT delete the Service document — use ServiceService.deleteService() for that.
   */
  removeServiceOffering = async (
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

      sendSuccess(res, "Service unlinked from provider profile successfully", {
        providerProfile: updated,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  // ─── Gallery Images ─────────────────────────────────────────────────────────

  /**
   * POST /providers/:profileId/gallery
   *
   * Appends images to businessGalleryImages.
   * Delegates to ImageLinkingService — File records have entityId stamped at
   * the same time so the file and profile references stay in sync.
   *
   * Body: { "fileIds": ["<objectId>", "<objectId>"] }
   */
  addGalleryImages = async (
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

      const invalidIds = fileIds.filter(
        (id: unknown) => typeof id !== "string" || !Types.ObjectId.isValid(id)
      );
      if (invalidIds.length > 0) {
        sendError(res, 400, `Invalid file IDs: ${invalidIds.join(", ")}`);
        return;
      }

      const objectIds = fileIds.map((id: string) => new Types.ObjectId(id));

      const updated = await providerProfileService.addGalleryImages(
        profileId,
        objectIds,
        uploadedBy
      );

      sendSuccess(res, "Gallery images added successfully", {
        providerProfile: updated,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * DELETE /providers/:profileId/gallery/:fileId
   *
   * Removes a single image from businessGalleryImages.
   * Does NOT delete the underlying File document — caller handles cleanup.
   */
  removeGalleryImage = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);
      const fileId = getParam(req.params.fileId);

      const updated = await providerProfileService.removeGalleryImage(
        profileId,
        fileId
      );

      sendSuccess(res, "Gallery image removed successfully", {
        providerProfile: updated,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * PUT /providers/:profileId/gallery/reorder
   *
   * Replaces businessGalleryImages with a caller-supplied ordered list.
   * Validates every ID belongs to this provider's existing gallery — prevents
   * injection of foreign file IDs.
   *
   * Body: { "orderedFileIds": ["<fileId1>", "<fileId2>", …] }
   */
  reorderGalleryImages = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);
      const { orderedFileIds } = req.body;

      if (!Array.isArray(orderedFileIds) || orderedFileIds.length === 0) {
        sendError(res, 400, "orderedFileIds must be a non-empty array");
        return;
      }

      const invalidIds = orderedFileIds.filter(
        (id: unknown) => typeof id !== "string" || !Types.ObjectId.isValid(id)
      );
      if (invalidIds.length > 0) {
        sendError(res, 400, `Invalid file IDs: ${invalidIds.join(", ")}`);
        return;
      }

      const updated = await providerProfileService.reorderGalleryImages(
        profileId,
        orderedFileIds
      );

      sendSuccess(res, "Gallery images reordered successfully", {
        providerProfile: updated,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  // ─── ID Document Images ─────────────────────────────────────────────────────

  /**
   * POST /providers/:profileId/id-images
   *
   * Attaches government ID document images to idDetails.fileImageId[].
   * idDetails metadata (type, number) must already exist — set it first via
   * PUT /providers/:profileId/business.
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

      const invalidIds = fileIds.filter(
        (id: unknown) => typeof id !== "string" || !Types.ObjectId.isValid(id)
      );
      if (invalidIds.length > 0) {
        sendError(res, 400, `Invalid file IDs: ${invalidIds.join(", ")}`);
        return;
      }

      const objectIds = fileIds.map((id: string) => new Types.ObjectId(id));

      const updated = await providerProfileService.updateIdImages(
        profileId,
        objectIds,
        uploadedBy
      );

      sendSuccess(res, "ID images uploaded and linked successfully", {
        providerProfile: updated,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * DELETE /providers/:profileId/id-images/:fileId
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

      const updated = await providerProfileService.removeIdImage(
        profileId,
        fileId
      );

      sendSuccess(res, "ID image removed successfully", {
        providerProfile: updated,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  };

  /**
   * PUT /providers/:profileId/id-images/replace
   *
   * Atomically replaces all ID images with a new set.
   * Used when the provider re-uploads their documents (e.g. expired ID).
   *
   * Body: { "fileIds": ["<objectId>", …] }  — empty array clears all images
   */
  replaceIdImages = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const profileId = getParam(req.params.profileId);
      const uploadedBy = req.userId!;
      const { fileIds } = req.body;

      if (!Array.isArray(fileIds)) {
        sendError(
          res,
          400,
          "fileIds must be an array (can be empty to clear all images)"
        );
        return;
      }

      const invalidIds = fileIds.filter(
        (id: unknown) => typeof id !== "string" || !Types.ObjectId.isValid(id)
      );
      if (invalidIds.length > 0) {
        sendError(res, 400, `Invalid file IDs: ${invalidIds.join(", ")}`);
        return;
      }

      const objectIds = fileIds.map((id: string) => new Types.ObjectId(id));

      const updated = await providerProfileService.replaceIdImages(
        profileId,
        objectIds,
        uploadedBy
      );

      sendSuccess(
        res,
        fileIds.length > 0
          ? "ID images replaced successfully"
          : "ID images cleared successfully",
        { providerProfile: updated }
      );
    } catch (error) {
      handleServiceError(res, error);
    }
  };
}