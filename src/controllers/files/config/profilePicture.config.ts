import { Types } from "mongoose";
import ProfileModel from "../../../models/profiles/base.profile.model";
import { MongoDBFileService } from "../../../service/files/mongodb.file.service";
import { EntityImageConfig } from "../../../types/entityConfig";
import { FileEntityType } from "../../../types/file.types";
import { AuthenticatedRequest } from "../../../types/user.types";

// ─── Profile Picture Config ───────────────────────────────────────────────────
//
// Upload mode: "linked"
//   req.userId is always present (behind auth middleware), so entityId is
//   known at upload time and is stamped onto the file record immediately.
//   linkToEntity is called right after upload. If the profile doesn't exist
//   yet, it returns false and the file waits — linkFileToCreatedEntity is
//   called by UserProfileService.createProfile to complete the link.
//
// getEntityId returns req.userId because IUserProfile is looked up by userId,
//   not by _id. Model side effects use findOneAndUpdate({ userId }) accordingly.
//
// getPublicEntityId enables the "view another user's picture" route via
//   req.params.userId, returning public-safe fields only.

export const profilePictureConfig: EntityImageConfig = {
  entityType: FileEntityType.USER,
  label: "profile_picture",
  folderPrefix: "users",
  imageFieldName: "profilePictureId",
  maxSizeBytes: 10 * 1024 * 1024, // 10 MB

  uploadMode: "linked",

  getLinkedFolder: (entityId: string) =>
    `users/${entityId}/profile_picture`,

  // ── Entity ID extraction ──────────────────────────────────────────────────

  getEntityId: (req: AuthenticatedRequest): string | undefined => req.userId,

  getPublicEntityId: (req: AuthenticatedRequest): string | undefined => {
    const { userId } = req.params as { userId?: string };
    return userId;
  },

  // ── Model side effects ────────────────────────────────────────────────────

  // IUserProfile is keyed by userId, not _id.
  // findOneAndUpdate({ userId }) is intentional — findByIdAndUpdate would
  // look up the profile where _id = userId, which is always wrong here.
  linkToEntity: async (
    entityId: string,
    fileId: Types.ObjectId,
    _userId: string
  ): Promise<boolean> => {
    const result = await ProfileModel.findOneAndUpdate(
      { userId: new Types.ObjectId(entityId), isDeleted: false },
      { profilePictureId: fileId },
      { new: true }
    );
    return result !== null;
  },

  unlinkFromEntity: async (
    entityId: string,
    fileId: Types.ObjectId,
    _userId: string
  ): Promise<void> => {
    await ProfileModel.updateOne(
      {
        userId: new Types.ObjectId(entityId),
        profilePictureId: fileId,
        isDeleted: false,
      },
      { $unset: { profilePictureId: 1 } }
    );
  },

  // ── Entity creation hook ──────────────────────────────────────────────────

  // Called by UserProfileService.createProfile (and restoreProfile) after the
  // profile document is written to the database.
  //
  // For profile pictures the entityId is already on the file record (set at
  // upload time in linked mode), so no file update is needed here.
  // We only need to look up the waiting file and write profilePictureId on the
  // newly created profile.
  //
  // mongoService is used to find the pending file by entityId + label.
  linkFileToCreatedEntity: async (
    _fileId: Types.ObjectId,
    entityId: string,
    userId: string,
    mongoService: MongoDBFileService
  ): Promise<boolean> => {
    // Find the active profile picture for this user.
    // entityId === userId for this entity type (file was stored with
    // entityId = new Types.ObjectId(userId) at upload time).
    const files = await mongoService.getFilesByEntity(
      FileEntityType.USER,
      entityId,
      { status: "active" }
    );

    const pendingFile = files.find((f) => f.label === "profile_picture");
    if (!pendingFile) return false;

    // Link the file to the now-existing profile document
    const result = await ProfileModel.findOneAndUpdate(
      { userId: new Types.ObjectId(entityId), isDeleted: false },
      { profilePictureId: pendingFile._id },
      { new: true }
    );

    return result !== null;
  },
};

