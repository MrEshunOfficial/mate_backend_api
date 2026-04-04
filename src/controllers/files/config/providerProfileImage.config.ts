import { Types } from "mongoose";
import { MongoDBFileService } from "../../../service/files/mongodb.file.service";
import { EntityImageConfig } from "../../../types/entityConfig";
import { FileEntityType } from "../../../types/file.types";
import { AuthenticatedRequest } from "../../../types/user.types";
import { getParam } from "../../../utils/auth/auth.controller.utils";
import ProviderProfileModel from "../../../models/profiles/provider.profile.model";

// ─── Provider Profile Image Configs ──────────────────────────────────────────
//
// Both configs share FileEntityType.PROVIDER_PROFILE but target different
// fields on the ProviderProfile document:
//
//   providerGalleryConfig  → businessGalleryImages   (public-facing gallery)
//   providerIdImageConfig  → idDetails.fileImageId   (private ID documents)
//
// Both fields are arrays, so linkToEntity uses $addToSet and unlinkFromEntity
// uses $pull — the same array mechanics as clientIdImageConfig — ensuring that
// individual file operations never clobber other entries in the array.
//
// Upload mode: "linked" for both
//   Providers must be onboarded (ProviderProfile must exist) before they can
//   upload gallery or ID images. entityId = ProviderProfile._id is known at
//   upload time and is stamped onto the file record immediately.
//
// getEntityId reads req.params.providerProfileId (ProviderProfile._id) for
//   both configs. This is NOT the userId — ProviderProfile is its own
//   collection with its own _id, linked back via DomainProfile.profileId.
//
// Gallery images are public:
//   providerGalleryConfig exposes getPublicEntityId so unauthenticated users
//   browsing the platform can view a provider's gallery.
//
// ID images are private:
//   providerIdImageConfig has no getPublicEntityId. Routes using it must sit
//   behind auth + admin/ownership middleware.

// ─── Provider Gallery Config ──────────────────────────────────────────────────

export const providerGalleryConfig: EntityImageConfig = {
  entityType: FileEntityType.PROVIDER_PROFILE,
  label: "provider_gallery",
  folderPrefix: "providers",
  imageFieldName: "businessGalleryImages",
  maxSizeBytes: 10 * 1024 * 1024, // 10 MB

  uploadMode: "linked",

  getLinkedFolder: (entityId: string) => `providers/${entityId}/gallery`,

  // ── Entity ID extraction ──────────────────────────────────────────────────

  getEntityId: (req: AuthenticatedRequest): string | undefined =>
    getParam(req.params.providerProfileId),

  // Gallery images are public — browsing clients can view them.
  getPublicEntityId: (req: AuthenticatedRequest): string | undefined =>
    getParam(req.params.providerProfileId),

  // ── Model side effects ────────────────────────────────────────────────────

  linkToEntity: async (
    entityId: string,
    fileId: Types.ObjectId,
    _userId: string,
  ): Promise<boolean> => {
    const result = await ProviderProfileModel.findOneAndUpdate(
      { _id: new Types.ObjectId(entityId), isDeleted: false },
      { $addToSet: { businessGalleryImages: fileId } },
      { new: true },
    );
    return result !== null;
  },

  unlinkFromEntity: async (
    entityId: string,
    fileId: Types.ObjectId,
    _userId: string,
  ): Promise<void> => {
    await ProviderProfileModel.updateOne(
      { _id: new Types.ObjectId(entityId), isDeleted: false },
      { $pull: { businessGalleryImages: fileId } },
    );
  },

  // ── Entity creation hook ──────────────────────────────────────────────────
  //
  // Called by ProviderProfileService.createProviderProfile after the profile
  // document is written. The files are already stamped with entityId at upload
  // time (linked mode), so no file update is needed here.
  //
  // Collects all pending gallery files for this profile and adds them to
  // businessGalleryImages in one $addToSet pass.
  linkFileToCreatedEntity: async (
    _fileId: Types.ObjectId,
    entityId: string,
    _userId: string,
    mongoService: MongoDBFileService,
  ): Promise<boolean> => {
    const files = await mongoService.getFilesByEntity(
      FileEntityType.PROVIDER_PROFILE,
      entityId,
      { status: "active" },
    );

    const pendingFiles = files.filter((f) => f.label === "provider_gallery");
    if (pendingFiles.length === 0) return false;

    const fileIds = pendingFiles.map((f) => f._id);

    const result = await ProviderProfileModel.findOneAndUpdate(
      { _id: new Types.ObjectId(entityId), isDeleted: false },
      { $addToSet: { businessGalleryImages: { $each: fileIds } } },
      { new: true },
    );

    return result !== null;
  },
};

// ─── Provider ID Image Config ─────────────────────────────────────────────────

export const providerIdImageConfig: EntityImageConfig = {
  entityType: FileEntityType.PROVIDER_PROFILE,
  label: "provider_id_image",
  folderPrefix: "providers",
  imageFieldName: "idDetails.fileImageId",
  maxSizeBytes: 10 * 1024 * 1024, // 10 MB

  uploadMode: "linked",

  getLinkedFolder: (entityId: string) => `providers/${entityId}/id_documents`,

  // ── Entity ID extraction ──────────────────────────────────────────────────

  getEntityId: (req: AuthenticatedRequest): string | undefined =>
    getParam(req.params.providerProfileId),

  // No public route — ID documents must not be publicly accessible.
  getPublicEntityId: undefined,

  // ── Model side effects ────────────────────────────────────────────────────

  linkToEntity: async (
    entityId: string,
    fileId: Types.ObjectId,
    _userId: string,
  ): Promise<boolean> => {
    const result = await ProviderProfileModel.findOneAndUpdate(
      { _id: new Types.ObjectId(entityId), isDeleted: false },
      { $addToSet: { "idDetails.fileImageId": fileId } },
      { new: true },
    );
    return result !== null;
  },

  unlinkFromEntity: async (
    entityId: string,
    fileId: Types.ObjectId,
    _userId: string,
  ): Promise<void> => {
    await ProviderProfileModel.updateOne(
      { _id: new Types.ObjectId(entityId), isDeleted: false },
      { $pull: { "idDetails.fileImageId": fileId } },
    );
  },

  // ── Entity creation hook ──────────────────────────────────────────────────
  // Same pattern as providerGalleryConfig — collects all pending id_image
  // files and adds them to idDetails.fileImageId in one pass.
  linkFileToCreatedEntity: async (
    _fileId: Types.ObjectId,
    entityId: string,
    _userId: string,
    mongoService: MongoDBFileService,
  ): Promise<boolean> => {
    const files = await mongoService.getFilesByEntity(
      FileEntityType.PROVIDER_PROFILE,
      entityId,
      { status: "active" },
    );

    const pendingFiles = files.filter((f) => f.label === "provider_id_image");
    if (pendingFiles.length === 0) return false;

    const fileIds = pendingFiles.map((f) => f._id);

    const result = await ProviderProfileModel.findOneAndUpdate(
      { _id: new Types.ObjectId(entityId), isDeleted: false },
      { $addToSet: { "idDetails.fileImageId": { $each: fileIds } } },
      { new: true },
    );

    return result !== null;
  },
};
