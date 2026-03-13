import { Types } from "mongoose";
import { CategoryModel } from "../../../models/service/categoryModel";
import { MongoDBFileService } from "../../../service/files/mongodb.file.service";
import { EntityImageConfig } from "../../../types/entityConfig";
import { FileEntityType } from "../../../types/file.types";
import { AuthenticatedRequest } from "../../../types/user.types";
import { getParam } from "../../../utils/auth/auth.controller.utils";

// ─── Category Cover Config ────────────────────────────────────────────────────
//
// Upload mode: "orphan"
//   The cover upload endpoint has no categoryId in its URL — a category may
//   not exist yet when an admin uploads its cover. The upload returns a fileId
//   that the caller passes as catCoverId in the category create or update body.
//
//   At that point, the category handler calls linkFileToCreatedEntity which:
//     1. Stamps entityId = categoryId onto the file record so that
//        getFilesByEntity(CATEGORY, categoryId) can find it going forward.
//     2. Sets catCoverId on the category document.
//
//   Without step 1, every subsequent file operation (get, archive, stats,
//   restore, optimized) would silently return "not found" because the
//   MongoDB query searches by entityId and the file record has none set.
//
// getEntityId reads req.params.categoryId — used for all non-upload endpoints
//   (get, delete, getOptimized, archive, restore, stats, etc.) where the
//   categoryId is always present in the URL.
//
// No getPublicEntityId — category covers are not user-scoped and the standard
//   get handler already covers public access via the categoryId param.

export const categoryCoverConfig: EntityImageConfig = {
  entityType: FileEntityType.CATEGORY,
  label: "category_cover",
  folderPrefix: "categories",
  imageFieldName: "catCoverId",
  maxSizeBytes: 10 * 1024 * 1024, // 10 MB

  uploadMode: "orphan",

  // Orphan uploads are stored under a pending folder keyed by the uploader.
  // The folder path is cosmetic in Cloudinary — file lookups always use
  // entityId on the MongoDB record, not the Cloudinary folder.
  getOrphanFolder: (uploaderId: string) =>
    `categories/pending/${uploaderId}`,

  // ── Entity ID extraction ──────────────────────────────────────────────────

  // getParam safely unwraps Express params that may arrive as string | string[]
  getEntityId: (req: AuthenticatedRequest): string | undefined =>
    getParam(req.params.categoryId),

  // getPublicEntityId is intentionally omitted — getEntityId already handles
  // all access patterns for category covers (there is no user-scoped variant).

  // ── Model side effects ────────────────────────────────────────────────────

  linkToEntity: async (
    entityId: string,
    fileId: Types.ObjectId,
    userId: string
  ): Promise<boolean> => {
    const result = await CategoryModel.findOneAndUpdate(
      { _id: new Types.ObjectId(entityId), isDeleted: false },
      {
        catCoverId: fileId,
        lastModifiedBy: new Types.ObjectId(userId),
      },
      { new: true }
    );
    return result !== null;
  },

  unlinkFromEntity: async (
    entityId: string,
    fileId: Types.ObjectId,
    userId: string
  ): Promise<void> => {
    await CategoryModel.updateOne(
      {
        _id: new Types.ObjectId(entityId),
        catCoverId: fileId,
        isDeleted: false,
      },
      {
        $unset: { catCoverId: 1 },
        lastModifiedBy: new Types.ObjectId(userId),
      }
    );
  },

  // ── Entity creation / update hook ─────────────────────────────────────────

  // Called by the category create/update handler whenever catCoverId is
  // present in the request body. Must be called for BOTH create and update
  // flows — the cover can be attached to an existing category just as it can
  // be attached at creation time.
  //
  // Two-step process (both steps are required):
  //
  //   Step 1 — Stamp entityId onto the file record.
  //     The file was uploaded in orphan mode with no entityId. Without this
  //     step, getFilesByEntity(CATEGORY, categoryId) returns nothing and
  //     every subsequent operation (archive, restore, stats, optimized) fails.
  //
  //   Step 2 — Write catCoverId onto the category document.
  //     If the category creation handler already writes catCoverId as part of
  //     its normal document save, step 2 is redundant but harmless. Calling
  //     linkToEntity here keeps the config self-contained and removes the need
  //     for the category handler to know about the file-side details.
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

    // Step 2: set catCoverId on the category document
    return categoryCoverConfig.linkToEntity(entityId, fileId, userId);
  },

  getEntityIdFromBody: (req: AuthenticatedRequest): string | undefined => {
  const { categoryId } = req.body as { categoryId?: string };
  return categoryId;
},
};

