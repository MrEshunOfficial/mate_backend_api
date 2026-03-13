import { Response } from "express";
import { MongoDBFileService } from "../../../service/files/mongodb.file.service";
import { EntityImageConfig } from "../../../types/entityConfig";
import { IFile } from "../../../types/file.types";
import { AuthenticatedRequest } from "../../../types/user.types";
import { validateObjectId, handleError } from "../../../utils/auth/auth.controller.utils";

// ─── GenericMongoDBImageHandler ───────────────────────────────────────────────

// Handles all MongoDB-side operations for any entity image type:
// record retrieval, history, metadata updates, archive/restore, delete, stats,
// and cleanup of stale archived files.
//
// All entity-specific behaviour is isolated in EntityImageConfig.
// This class never imports models.
//
// Instantiate once per entity type in MongoDBFileController:
//   new GenericMongoDBImageHandler(profilePictureConfig, fileService)
//   new GenericMongoDBImageHandler(categoryCoverConfig,  fileService)

export class GenericMongoDBImageHandler {
  constructor(
    private readonly config: EntityImageConfig,
    private readonly fileService: MongoDBFileService
  ) {}

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private async getActiveFile(entityId: string): Promise<IFile | null> {
    const files = await this.fileService.getFilesByEntity(
      this.config.entityType,
      entityId,
      { status: "active" }
    );
    return files.find((f) => f.label === this.config.label) ?? null;
  }

  // Ownership check before restore / delete operations on a specific fileId.
  // For user-owned entities (FileEntityType.USER) we check uploaderId === userId
  // because entityId on those records IS the userId — consistent with how
  // profile pictures are stored (entityId: new Types.ObjectId(userId)).
  // For all other entity types we check file.entityId === entityId.
  private isFileOwnedBy(
    file: IFile,
    entityId: string,
    userId: string
  ): boolean {
    if (this.config.entityType === "user") {
      return file.uploaderId?.toString() === userId;
    }
    return file.entityId?.toString() === entityId;
  }

  // ─── Handlers ─────────────────────────────────────────────────────────────

  /**
   * GET /record  — returns the MongoDB file record for the active image.
   * Marks the file as accessed (fire-and-forget — must not delay response).
   */
  getRecord = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const entityId = this.config.getEntityId(req);
      if (!entityId || !validateObjectId(entityId)) {
        res
          .status(400)
          .json({ success: false, message: "Invalid or missing entity ID" });
        return;
      }

      const file = await this.getActiveFile(entityId);
      if (!file) {
        res
          .status(404)
          .json({ success: false, message: `${this.config.label} not found` });
        return;
      }

      // Fire-and-forget — access tracking must not delay the response
      this.fileService.markAsAccessed(file._id).catch((err) =>
        console.warn(`[${this.config.label}] markAsAccessed failed:`, err)
      );

      res.status(200).json({
        success: true,
        data: {
          fileId: file._id,
          url: file.url,
          thumbnailUrl: file.thumbnailUrl,
          uploadedAt: file.uploadedAt,
          metadata: file.metadata,
        },
      });
    } catch (error) {
      handleError(res, error, `Failed to get ${this.config.label} record`);
    }
  };

  /**
   * GET /:entityId/record  — returns another entity's active image record.
   * Public-safe fields only (no metadata).
   * Only available when config.getPublicEntityId is defined.
   */
  getPublicRecord = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      if (!this.config.getPublicEntityId) {
        res.status(404).json({
          success: false,
          message: "Public access is not available for this entity type",
        });
        return;
      }

      const entityId = this.config.getPublicEntityId(req);
      if (!entityId || !validateObjectId(entityId)) {
        res.status(400).json({ success: false, message: "Invalid entity ID" });
        return;
      }

      const file = await this.getActiveFile(entityId);
      if (!file) {
        res
          .status(404)
          .json({ success: false, message: `${this.config.label} not found` });
        return;
      }

      res.status(200).json({
        success: true,
        data: {
          fileId: file._id,
          url: file.url,
          thumbnailUrl: file.thumbnailUrl,
          uploadedAt: file.uploadedAt,
        },
      });
    } catch (error) {
      handleError(
        res,
        error,
        `Failed to get ${this.config.label} public record`
      );
    }
  };

  /**
   * GET /history  — returns the current active image + paginated archive of past images.
   * Query params: limit (default 10), skip (default 0)
   */
  getHistory = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const entityId = this.config.getEntityId(req);
      if (!entityId || !validateObjectId(entityId)) {
        res
          .status(400)
          .json({ success: false, message: "Invalid or missing entity ID" });
        return;
      }

      const { limit = "10", skip = "0" } = req.query;

      const [activeFiles, archivedFiles] = await Promise.all([
        this.fileService.getFilesByEntity(this.config.entityType, entityId, {
          status: "active",
          limit: 1,
        }),
        this.fileService.getFilesByEntity(this.config.entityType, entityId, {
          status: "archived",
          limit: parseInt(limit as string, 10),
          skip: parseInt(skip as string, 10),
          sort: { uploadedAt: -1 },
        }),
      ]);

      const current =
        activeFiles.find((f) => f.label === this.config.label) ?? null;
      const history = archivedFiles.filter(
        (f) => f.label === this.config.label
      );

      res.status(200).json({
        success: true,
        data: { current, history, totalArchived: history.length },
      });
    } catch (error) {
      handleError(res, error, `Failed to get ${this.config.label} history`);
    }
  };

  /**
   * PATCH /metadata  — updates description and/or tags on the active image record.
   * Body: { description?: string; tags?: string[] }
   * Returns 400 if neither field is provided.
   */
  updateMetadata = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res
          .status(401)
          .json({ success: false, message: "User not authenticated" });
        return;
      }

      const entityId = this.config.getEntityId(req);
      if (!entityId || !validateObjectId(entityId)) {
        res
          .status(400)
          .json({ success: false, message: "Invalid or missing entity ID" });
        return;
      }

      const { description, tags } = req.body as {
        description?: string;
        tags?: string[];
      };

      const file = await this.getActiveFile(entityId);
      if (!file) {
        res
          .status(404)
          .json({ success: false, message: `${this.config.label} not found` });
        return;
      }

      // Build the update payload from only the fields that were provided.
      // UpdateFileData accepts: fileName, description, tags, label, metadata, status
      const updateData: Record<string, unknown> = {};
      if (description !== undefined) updateData.description = description;
      if (tags !== undefined) updateData.tags = tags;

      if (Object.keys(updateData).length === 0) {
        res.status(400).json({
          success: false,
          message:
            "No valid fields provided for update. Accepted fields: description, tags",
        });
        return;
      }

      const updatedFile = await this.fileService.updateFile(
        file._id,
        updateData
      );

      res.status(200).json({
        success: true,
        message: `${this.config.label} metadata updated successfully`,
        data: updatedFile,
      });
    } catch (error) {
      handleError(
        res,
        error,
        `Failed to update ${this.config.label} metadata`
      );
    }
  };

  /**
   * POST /archive  — soft-deletes the active image and unlinks it from
   * the entity document. The Cloudinary asset is NOT deleted.
   * Use the Cloudinary controller's DELETE endpoint for a full removal.
   */
  archive = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res
          .status(401)
          .json({ success: false, message: "User not authenticated" });
        return;
      }

      const entityId = this.config.getEntityId(req);
      if (!entityId || !validateObjectId(entityId)) {
        res
          .status(400)
          .json({ success: false, message: "Invalid or missing entity ID" });
        return;
      }

      const file = await this.getActiveFile(entityId);
      if (!file) {
        res
          .status(404)
          .json({ success: false, message: `${this.config.label} not found` });
        return;
      }

      // Archive the file and unlink from entity in parallel
      const [archivedFile] = await Promise.all([
        this.fileService.archiveFile(file._id),
        this.config.unlinkFromEntity(entityId, file._id, userId),
      ]);

      res.status(200).json({
        success: true,
        message: `${this.config.label} archived successfully`,
        data: archivedFile,
      });
    } catch (error) {
      handleError(res, error, `Failed to archive ${this.config.label}`);
    }
  };

  /**
   * POST /restore/:fileId  — restores an archived image to active.
   *   1. Validates ownership of the target file.
   *   2. Archives the currently active image (if any).
   *   3. Restores the target file to active status.
   *   4. Re-links imageFieldName on the entity document.
   */
  restore = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res
          .status(401)
          .json({ success: false, message: "User not authenticated" });
        return;
      }

      const entityId = this.config.getEntityId(req);
      const { fileId } = req.params as { fileId: string };

      if (!entityId || !validateObjectId(entityId)) {
        res.status(400).json({ success: false, message: "Invalid entity ID" });
        return;
      }

      if (!validateObjectId(fileId)) {
        res.status(400).json({ success: false, message: "Invalid file ID" });
        return;
      }

      const file = await this.fileService.getFileById(fileId);
      if (!file) {
        res.status(404).json({ success: false, message: "File not found" });
        return;
      }

      if (file.label !== this.config.label) {
        res.status(400).json({
          success: false,
          message: `This file is not a ${this.config.label}`,
        });
        return;
      }

      if (!this.isFileOwnedBy(file, entityId, userId)) {
        res.status(403).json({
          success: false,
          message: "You do not have permission to restore this file",
        });
        return;
      }

      // Archive the current active file first (unlink + archive in parallel)
      const current = await this.getActiveFile(entityId);
      if (current) {
        await Promise.all([
          this.fileService.archiveFile(current._id),
          this.config.unlinkFromEntity(entityId, current._id, userId),
        ]);
      }

      const restoredFile = await this.fileService.restoreFile(fileId);
      if (!restoredFile) {
        res
          .status(500)
          .json({ success: false, message: "Failed to restore file" });
        return;
      }

     // AFTER
      const linked = await this.config.linkToEntity(entityId, restoredFile._id, userId);
      res.status(200).json({
        success: true,
        message: `${this.config.label} restored successfully`,
        data: { ...restoredFile, linkedToEntity: linked },
      });


      res.status(200).json({
        success: true,
        message: `${this.config.label} restored successfully`,
        data: restoredFile,
      });
    } catch (error) {
      handleError(res, error, `Failed to restore ${this.config.label}`);
    }
  };

  /**
   * DELETE   — permanently deletes the active image record from MongoDB
   * and unlinks it from the entity document.
   * NOTE: This does NOT delete the Cloudinary asset.
   * Use the Cloudinary controller's DELETE endpoint if storage removal is needed.
   */
  delete = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res
          .status(401)
          .json({ success: false, message: "User not authenticated" });
        return;
      }

      const entityId = this.config.getEntityId(req);
      if (!entityId || !validateObjectId(entityId)) {
        res
          .status(400)
          .json({ success: false, message: "Invalid or missing entity ID" });
        return;
      }

      const file = await this.getActiveFile(entityId);
      if (!file) {
        res
          .status(404)
          .json({ success: false, message: `${this.config.label} not found` });
        return;
      }

      await Promise.all([
        this.config.unlinkFromEntity(entityId, file._id, userId),
        this.fileService.deleteFile(file._id),
      ]);

      res.status(200).json({
        success: true,
        message: `${this.config.label} deleted permanently`,
      });
    } catch (error) {
      handleError(res, error, `Failed to delete ${this.config.label}`);
    }
  };

  /**
   * GET /stats  — returns storage and count statistics for all images
   * (active + archived) belonging to this entity.
   */
  getStats = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const entityId = this.config.getEntityId(req);
      if (!entityId || !validateObjectId(entityId)) {
        res
          .status(400)
          .json({ success: false, message: "Invalid or missing entity ID" });
        return;
      }

      const [activeFiles, archivedFiles] = await Promise.all([
        this.fileService.getFilesByEntity(this.config.entityType, entityId, {
          status: "active",
        }),
        this.fileService.getFilesByEntity(this.config.entityType, entityId, {
          status: "archived",
        }),
      ]);

      const active = activeFiles.filter((f) => f.label === this.config.label);
      const archived = archivedFiles.filter(
        (f) => f.label === this.config.label
      );

      // fileSize is optional on IFile — default to 0 when absent
      const totalSize = [...active, ...archived].reduce(
        (sum, f) => sum + (f.fileSize ?? 0),
        0
      );
      const current = active[0] ?? null;

      res.status(200).json({
        success: true,
        data: {
          current: current
            ? {
                fileId: current._id,
                url: current.url,
                thumbnailUrl: current.thumbnailUrl,
                fileSize: current.fileSize,
                uploadedAt: current.uploadedAt,
              }
            : null,
          totalImages: active.length + archived.length,
          activeCount: active.length,
          archivedCount: archived.length,
          totalStorageUsed: totalSize,
          totalStorageUsedMB: (totalSize / (1024 * 1024)).toFixed(2),
        },
      });
    } catch (error) {
      handleError(
        res,
        error,
        `Failed to get ${this.config.label} statistics`
      );
    }
  };

  /**
   * DELETE /cleanup  — permanently deletes archived images older than
   * `daysOld` days (default 30), using deletedAt as the age reference.
   * deletedAt is set by FileModel.archive() — files archived via other
   * paths that do not set deletedAt are excluded from cleanup.
   * Query params: daysOld (default "30")
   *
   * NOTE: This removes MongoDB records only. Cloudinary assets for these
   * archived files should be cleaned separately if needed.
   */
  cleanupArchived = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res
          .status(401)
          .json({ success: false, message: "User not authenticated" });
        return;
      }

      const entityId = this.config.getEntityId(req);
      if (!entityId || !validateObjectId(entityId)) {
        res
          .status(400)
          .json({ success: false, message: "Invalid or missing entity ID" });
        return;
      }

      const { daysOld = "30" } = req.query;
      const cutoffDate = new Date();
      cutoffDate.setDate(
        cutoffDate.getDate() - parseInt(daysOld as string, 10)
      );

      const archivedFiles = await this.fileService.getFilesByEntity(
        this.config.entityType,
        entityId,
        { status: "archived" }
      );

      // Only target files that have a deletedAt timestamp older than the cutoff.
      // deletedAt is optional on IFile — files without it are skipped.
      const staleIds = archivedFiles
        .filter(
          (f) =>
            f.label === this.config.label &&
            f.deletedAt != null &&
            new Date(f.deletedAt) < cutoffDate
        )
        .map((f) => f._id);

      if (staleIds.length === 0) {
        res.status(200).json({
          success: true,
          message: `No archived ${this.config.label}s found older than the specified cutoff`,
          deletedCount: 0,
        });
        return;
      }

      const deletedCount = await this.fileService.bulkDeleteFiles(staleIds);

      res.status(200).json({
        success: true,
        message: `${deletedCount} archived ${this.config.label}(s) cleaned up successfully`,
        deletedCount,
      });
    } catch (error) {
      handleError(
        res,
        error,
        `Failed to cleanup archived ${this.config.label}s`
      );
    }
  };
}