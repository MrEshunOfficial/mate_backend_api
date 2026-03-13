import { Types } from "mongoose";
import { MongoDBFileService } from "../../../service/files/mongodb.file.service";
import { EntityImageConfig } from "../../../types/entityConfig";
import { FileEntityType } from "../../../types/file.types";
import { AuthenticatedRequest } from "../../../types/user.types";
import { getParam } from "../../../utils/auth/auth.controller.utils";
import { ServiceModel } from "../../../models/service/serviceModel";

// ─── Service Cover Config ─────────────────────────────────────────────────────
//
// Upload mode: "orphan"
//   The cover upload endpoint has no serviceId in its URL — a service may
//   not exist yet when a provider uploads its cover. The upload returns a
//   fileId that the caller passes as coverImage in the service create or
//   update body.
//
//   At that point, the service handler calls linkFileToCreatedEntity which:
//     1. Stamps entityId = serviceId onto the file record so that
//        getFilesByEntity(SERVICE, serviceId) can find it going forward.
//     2. Sets coverImage on the service document.
//
//   Without step 1, every subsequent file operation (get, archive, stats,
//   restore, optimized) would silently return "not found" because the
//   MongoDB query searches by entityId and the file record has none set.
//
// getEntityId reads req.params.serviceId — used for all non-upload endpoints
//   (get, delete, getOptimized, archive, restore, stats, etc.) where the
//   serviceId is always present in the URL.
//
// getPublicEntityId reads req.params.serviceId as well — service covers are
//   accessible publicly (published services are visible to unauthenticated
//   users browsing the platform).

export const serviceCoverConfig: EntityImageConfig = {
  entityType: FileEntityType.SERVICE,
  label: "service_cover",
  folderPrefix: "services",
  imageFieldName: "coverImage",
  maxSizeBytes: 10 * 1024 * 1024, // 10 MB

  uploadMode: "orphan",

  // Orphan uploads are stored under a pending folder keyed by the uploader.
  // The folder path is cosmetic in Cloudinary — file lookups always use
  // entityId on the MongoDB record, not the Cloudinary folder.
  getOrphanFolder: (uploaderId: string) =>
    `services/pending/${uploaderId}`,

  // ── Entity ID extraction ──────────────────────────────────────────────────
  getEntityId: (req: AuthenticatedRequest): string | undefined =>
    getParam(req.params.serviceId),

  // Service covers are publicly visible — browsing users can see them without
  // being authenticated.
  getPublicEntityId: (req: AuthenticatedRequest): string | undefined =>
    getParam(req.params.serviceId),

  // ── Model side effects ────────────────────────────────────────────────────
  linkToEntity: async (
    entityId: string,
    fileId: Types.ObjectId,
    userId: string
  ): Promise<boolean> => {
    const result = await ServiceModel.findOneAndUpdate(
      { _id: new Types.ObjectId(entityId), isDeleted: false },
      { coverImage: fileId },
      { new: true }
    );
    return result !== null;
  },

  unlinkFromEntity: async (
    entityId: string,
    fileId: Types.ObjectId,
    _userId: string
  ): Promise<void> => {
    await ServiceModel.updateOne(
      {
        _id: new Types.ObjectId(entityId),
        coverImage: fileId,
        isDeleted: false,
      },
      { $unset: { coverImage: 1 } }
    );
  },

  // ── Entity creation / update hook ─────────────────────────────────────────
  //
  // Called by the service create/update handler whenever coverImage is
  // present in the request body. Must be called for BOTH create and update
  // flows — the cover can be attached to an existing service just as it can
  // be attached at creation time.
  //
  // Two-step process (both steps are required):
  //
  //   Step 1 — Stamp entityId onto the file record.
  //     The file was uploaded in orphan mode with no entityId. Without this
  //     step, getFilesByEntity(SERVICE, serviceId) returns nothing and
  //     every subsequent operation (archive, restore, stats, optimized) fails.
  //
  //   Step 2 — Write coverImage onto the service document.
  //     If the service creation handler already writes coverImage as part of
  //     its normal document save, step 2 is redundant but harmless. Calling
  //     linkToEntity here keeps the config self-contained and removes the need
  //     for the service handler to know about the file-side details.
  linkFileToCreatedEntity: async (
    fileId: Types.ObjectId,
    entityId: string,
    userId: string,
    mongoService: MongoDBFileService
  ): Promise<boolean> => {
    // Step 1: stamp entityId so getFilesByEntity can find this file
    await mongoService.updateFile(fileId, {
      entityId: new Types.ObjectId(entityId),
    });

    // Step 2: set coverImage on the service document
    return serviceCoverConfig.linkToEntity(entityId, fileId, userId);
  },

  getEntityIdFromBody: (req: AuthenticatedRequest): string | undefined => {
    const { serviceId } = req.body as { serviceId?: string };
    return serviceId;
  },
};

