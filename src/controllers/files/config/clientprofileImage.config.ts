import { Types } from "mongoose";
import { MongoDBFileService } from "../../../service/files/mongodb.file.service";
import { EntityImageConfig } from "../../../types/entityConfig";
import { FileEntityType } from "../../../types/file.types";
import { AuthenticatedRequest } from "../../../types/user.types";
import { getParam } from "../../../utils/auth/auth.controller.utils";
import ClientProfileModel from "../../../models/profiles/client.profile.model";

// ─── Client ID Image Config ───────────────────────────────────────────────────
//
// Upload mode: "linked"
//   The client is authenticated and their ClientProfile already exists by the
//   time they can upload an ID document. entityId is known at upload time and
//   is stamped onto the file record immediately.
//
//   linkToEntity is called right after upload. linkFileToCreatedEntity is
//   available as a recovery path if the profile was somehow created after the
//   file was uploaded (e.g. a race condition during onboarding).
//
// Identity document storage (IdDetails.fileImageId):
//   A client's ID can span multiple image files (front + back of a national ID,
//   multiple pages of a passport). The field is an array — this config manages
//   a single file's membership in that array using $addToSet / $pull so that:
//     - Uploading a new page adds it without duplicating.
//     - Deleting a page removes only that entry.
//
// getEntityId reads req.params.clientProfileId — the ClientProfile._id.
//   ClientProfile is NOT keyed by userId (unlike IUserProfile); it has its own
//   _id that is stored on DomainProfile.profileId.
//
// getPublicEntityId is absent — ID documents are private and must never be
//   served to unauthenticated or unauthorised callers. Routes using this config
//   must sit behind auth + ownership middleware.

export const clientIdImageConfig: EntityImageConfig = {
  entityType: FileEntityType.CLIENT_PROFILE,
  label: "client_id_image",
  folderPrefix: "clients",
  imageFieldName: "idDetails.fileImageId",
  maxSizeBytes: 10 * 1024 * 1024, // 10 MB

  uploadMode: "linked",

  getLinkedFolder: (entityId: string) =>
    `clients/${entityId}/id_documents`,

  // ── Entity ID extraction ──────────────────────────────────────────────────

  // ClientProfile._id — present on all upload and management routes.
  getEntityId: (req: AuthenticatedRequest): string | undefined =>
    getParam(req.params.clientProfileId),

  // No public route — ID documents must not be publicly accessible.
  getPublicEntityId: undefined,

  // ── Model side effects ────────────────────────────────────────────────────

  // $addToSet prevents duplicates if the same file is linked twice.
  linkToEntity: async (
    entityId: string,
    fileId: Types.ObjectId,
    _userId: string
  ): Promise<boolean> => {
    const result = await ClientProfileModel.findOneAndUpdate(
      { _id: new Types.ObjectId(entityId), isDeleted: false },
      { $addToSet: { "idDetails.fileImageId": fileId } },
      { new: true }
    );
    return result !== null;
  },

  // $pull removes only this file from the array — other ID pages are untouched.
  unlinkFromEntity: async (
    entityId: string,
    fileId: Types.ObjectId,
    _userId: string
  ): Promise<void> => {
    await ClientProfileModel.updateOne(
      { _id: new Types.ObjectId(entityId), isDeleted: false },
      { $pull: { "idDetails.fileImageId": fileId } }
    );
  },

  // ── Entity creation hook ──────────────────────────────────────────────────
  //
  // Called by ClientProfileService.createClientProfile after the profile
  // document is written. The file was already stamped with entityId at upload
  // time (linked mode), so no file update is needed here.
  //
  // Finds all pending id_image files for this profile and adds them to
  // idDetails.fileImageId in one pass.
  linkFileToCreatedEntity: async (
    _fileId: Types.ObjectId,
    entityId: string,
    _userId: string,
    mongoService: MongoDBFileService
  ): Promise<boolean> => {
    const files = await mongoService.getFilesByEntity(
      FileEntityType.CLIENT_PROFILE,
      entityId,
      { status: "active" }
    );

    const pendingFiles = files.filter((f) => f.label === "client_id_image");
    if (pendingFiles.length === 0) return false;

    const fileIds = pendingFiles.map((f) => f._id);

    const result = await ClientProfileModel.findOneAndUpdate(
      { _id: new Types.ObjectId(entityId), isDeleted: false },
      { $addToSet: { "idDetails.fileImageId": { $each: fileIds } } },
      { new: true }
    );

    return result !== null;
  },
};

