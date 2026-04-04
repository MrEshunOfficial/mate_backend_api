import { Response } from "express";
import { Types } from "mongoose";
import { MongoDBFileService } from "../../../service/files/mongodb.file.service";
import { EntityImageConfig } from "../../../types/entityConfig";
import { IFile } from "../../../types/file.types";
import { AuthenticatedRequest } from "../../../types/user.types";
import {
  validateObjectId,
  handleError,
} from "../../../utils/auth/auth.controller.utils";

// ─── GenericMongoDBImageHandler ───────────────────────────────────────────────
//
// Handles all MongoDB-side operations for any entity image type:
// record retrieval, history, metadata updates, archive/restore, delete, stats,
// and cleanup of stale archived files.
//
// Single vs. array field behaviour is driven by config.isArray:
//   false (default) → one active file per entity; all operations target it implicitly.
//   true            → many active files per entity; archive/delete require a
//                     :fileId param to identify the specific file to act on.
//
// This class never imports models — all entity-specific logic lives in the config.

export class GenericMongoDBImageHandler {
  constructor(
    private readonly config: EntityImageConfig,
    private readonly fileService: MongoDBFileService,
  ) {}

  // ─── Private Helpers ──────────────────────────────────────────────────────

  /** Returns ALL active files for this config's label on the given entity. */
  private async getActiveFiles(entityId: string): Promise<IFile[]> {
    const files = await this.fileService.getFilesByEntity(
      this.config.entityType,
      entityId,
      { status: "active" },
    );
    return files.filter((f) => f.label === this.config.label);
  }

  /** Returns the single active file for non-array configs. */
  private async getActiveFile(entityId: string): Promise<IFile | null> {
    const files = await this.getActiveFiles(entityId);
    return files[0] ?? null;
  }

  // Ownership check before restore / delete operations on a specific fileId.
  private isFileOwnedBy(
    file: IFile,
    entityId: string,
    userId: string,
  ): boolean {
    if (this.config.entityType === "user") {
      return file.uploaderId?.toString() === userId;
    }
    return file.entityId?.toString() === entityId;
  }

  // ─── Handlers ─────────────────────────────────────────────────────────────

  /**
   * GET /record
   *
   * Non-array: returns the single active record, marks it accessed.
   * Array:     returns all active records; marks all of them accessed (fire-and-forget).
   */
  getRecord = async (
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> => {
    try {
      const entityId = this.config.getEntityId(req);
      if (!entityId || !validateObjectId(entityId)) {
        res
          .status(400)
          .json({ success: false, message: "Invalid or missing entity ID" });
        return;
      }

      if (this.config.isArray) {
        const files = await this.getActiveFiles(entityId);

        // Fire-and-forget — access tracking must not delay the response
        for (const f of files) {
          this.fileService
            .markAsAccessed(f._id)
            .catch((err) =>
              console.warn(
                `[${this.config.label}] markAsAccessed failed:`,
                err,
              ),
            );
        }

        res.status(200).json({
          success: true,
          data: {
            files: files.map((f) => ({
              fileId: f._id,
              url: f.url,
              thumbnailUrl: f.thumbnailUrl,
              uploadedAt: f.uploadedAt,
              metadata: f.metadata,
            })),
            count: files.length,
          },
        });
        return;
      }

      const file = await this.getActiveFile(entityId);
      if (!file) {
        res
          .status(404)
          .json({ success: false, message: `${this.config.label} not found` });
        return;
      }

      // Fire-and-forget
      this.fileService
        .markAsAccessed(file._id)
        .catch((err) =>
          console.warn(`[${this.config.label}] markAsAccessed failed:`, err),
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
   * GET /:entityId/record — public-safe fields only.
   * Only available when config.getPublicEntityId is defined.
   *
   * Non-array: returns one object.
   * Array:     returns { files: [ ... ] }.
   */
  getPublicRecord = async (
    req: AuthenticatedRequest,
    res: Response,
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

      if (this.config.isArray) {
        const files = await this.getActiveFiles(entityId);
        res.status(200).json({
          success: true,
          data: {
            files: files.map((f) => ({
              fileId: f._id,
              url: f.url,
              thumbnailUrl: f.thumbnailUrl,
              uploadedAt: f.uploadedAt,
            })),
            count: files.length,
          },
        });
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
        `Failed to get ${this.config.label} public record`,
      );
    }
  };

  /**
   * GET /history — current active image(s) + paginated archive.
   * Query params: limit (default 10), skip (default 0)
   *
   * For both array and non-array configs: returns all active files (not
   * capped at 1 for array types) alongside the paginated archived list.
   */
  getHistory = async (
    req: AuthenticatedRequest,
    res: Response,
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
        }),
        this.fileService.getFilesByEntity(this.config.entityType, entityId, {
          status: "archived",
          limit: parseInt(limit as string, 10),
          skip: parseInt(skip as string, 10),
          sort: { uploadedAt: -1 },
        }),
      ]);

      const current = activeFiles.filter((f) => f.label === this.config.label);
      const history = archivedFiles.filter(
        (f) => f.label === this.config.label,
      );

      res.status(200).json({
        success: true,
        data: {
          // For array configs `current` is an array of all active files.
          // For non-array configs it is a one-element array; callers that
          // expect a single object should read current[0].
          current,
          history,
          activeCount: current.length,
          totalArchived: history.length,
        },
      });
    } catch (error) {
      handleError(res, error, `Failed to get ${this.config.label} history`);
    }
  };

  /**
   * PATCH /metadata — updates description and/or tags on an active record.
   * Body: { description?: string; tags?: string[] }
   *
   * Non-array: targets the one active file.
   * Array:     requires req.params.fileId to identify the specific file.
   */
  updateMetadata = async (
    req: AuthenticatedRequest,
    res: Response,
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

      let file: IFile | null;

      if (this.config.isArray) {
        const { fileId } = req.params as { fileId?: string };
        if (!fileId || !validateObjectId(fileId)) {
          res.status(400).json({
            success: false,
            message:
              "fileId param is required when updating metadata on an array field",
          });
          return;
        }
        file = await this.fileService.getFileById(fileId);
        if (
          !file ||
          file.entityId?.toString() !==
            new Types.ObjectId(entityId).toString() ||
          file.label !== this.config.label
        ) {
          res.status(404).json({
            success: false,
            message: `${this.config.label} not found`,
          });
          return;
        }
      } else {
        file = await this.getActiveFile(entityId);
        if (!file) {
          res.status(404).json({
            success: false,
            message: `${this.config.label} not found`,
          });
          return;
        }
      }

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
        updateData,
      );

      res.status(200).json({
        success: true,
        message: `${this.config.label} metadata updated successfully`,
        data: updatedFile,
      });
    } catch (error) {
      handleError(res, error, `Failed to update ${this.config.label} metadata`);
    }
  };

  /**
   * POST /archive — soft-deletes an active image and unlinks it from the entity.
   * The Cloudinary asset is NOT deleted.
   *
   * Non-array: targets the one active file.
   * Array:     requires req.params.fileId — targets a specific file in the array.
   *            Route: POST /archive/:fileId
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

      let file: IFile | null;

      if (this.config.isArray) {
        const { fileId } = req.params as { fileId?: string };
        if (!fileId || !validateObjectId(fileId)) {
          res.status(400).json({
            success: false,
            message:
              "fileId param is required when archiving from an array field",
          });
          return;
        }

        file = await this.fileService.getFileById(fileId);
        if (
          !file ||
          file.entityId?.toString() !==
            new Types.ObjectId(entityId).toString() ||
          file.label !== this.config.label
        ) {
          res.status(404).json({
            success: false,
            message: `${this.config.label} not found`,
          });
          return;
        }

        if (file.status !== "active") {
          res.status(400).json({
            success: false,
            message: `${this.config.label} is already archived`,
          });
          return;
        }
      } else {
        file = await this.getActiveFile(entityId);
        if (!file) {
          res.status(404).json({
            success: false,
            message: `${this.config.label} not found`,
          });
          return;
        }
      }

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
   * POST /restore/:fileId — restores an archived image to active and re-links it.
   *
   * Non-array: archives the current active file first (one-in, one-out).
   * Array:     no displacement — the restored file is simply added back to the
   *            array alongside any currently active files.
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

      // Non-array: displace the current active file before restoring.
      // Array: no displacement — just restore alongside existing active files.
      if (!this.config.isArray) {
        const current = await this.getActiveFile(entityId);
        if (current) {
          await Promise.all([
            this.fileService.archiveFile(current._id),
            this.config.unlinkFromEntity(entityId, current._id, userId),
          ]);
        }
      }

      const restoredFile = await this.fileService.restoreFile(fileId);
      if (!restoredFile) {
        res
          .status(500)
          .json({ success: false, message: "Failed to restore file" });
        return;
      }

      let linked = false;
      try {
        linked = await this.config.linkToEntity(
          entityId,
          restoredFile._id,
          userId,
        );
      } catch (err) {
        console.warn(
          `[${this.config.label}] linkToEntity on restore failed:`,
          err,
        );
      }

      res.status(200).json({
        success: true,
        message: `${this.config.label} restored successfully`,
        data: { ...restoredFile, linkedToEntity: linked },
      });
    } catch (error) {
      handleError(res, error, `Failed to restore ${this.config.label}`);
    }
  };

  /**
   * DELETE — permanently removes the MongoDB record and unlinks from entity.
   * Does NOT delete the Cloudinary asset.
   *
   * Non-array: targets the one active file.
   * Array:     requires req.params.fileId — targets a specific file in the array.
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

      let file: IFile | null;

      if (this.config.isArray) {
        const { fileId } = req.params as { fileId?: string };
        if (!fileId || !validateObjectId(fileId)) {
          res.status(400).json({
            success: false,
            message:
              "fileId param is required when deleting from an array field",
          });
          return;
        }

        file = await this.fileService.getFileById(fileId);
        if (
          !file ||
          file.entityId?.toString() !==
            new Types.ObjectId(entityId).toString() ||
          file.label !== this.config.label
        ) {
          res.status(404).json({
            success: false,
            message: `${this.config.label} not found`,
          });
          return;
        }
      } else {
        file = await this.getActiveFile(entityId);
        if (!file) {
          res.status(404).json({
            success: false,
            message: `${this.config.label} not found`,
          });
          return;
        }
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
   * GET /stats — storage and count statistics for all images (active + archived).
   *
   * For array configs, `current` in the response is an array of all active files.
   * For non-array configs, `current` is the single active file or null.
   */
  getStats = async (
    req: AuthenticatedRequest,
    res: Response,
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
        (f) => f.label === this.config.label,
      );
      const totalSize = [...active, ...archived].reduce(
        (sum, f) => sum + (f.fileSize ?? 0),
        0,
      );

      const currentData = this.config.isArray
        ? active.map((f) => ({
            fileId: f._id,
            url: f.url,
            thumbnailUrl: f.thumbnailUrl,
            fileSize: f.fileSize,
            uploadedAt: f.uploadedAt,
          }))
        : active[0]
          ? {
              fileId: active[0]._id,
              url: active[0].url,
              thumbnailUrl: active[0].thumbnailUrl,
              fileSize: active[0].fileSize,
              uploadedAt: active[0].uploadedAt,
            }
          : null;

      res.status(200).json({
        success: true,
        data: {
          current: currentData,
          totalImages: active.length + archived.length,
          activeCount: active.length,
          archivedCount: archived.length,
          totalStorageUsed: totalSize,
          totalStorageUsedMB: (totalSize / (1024 * 1024)).toFixed(2),
        },
      });
    } catch (error) {
      handleError(res, error, `Failed to get ${this.config.label} statistics`);
    }
  };

  /**
   * DELETE /cleanup — permanently deletes archived images older than `daysOld` days.
   * deletedAt is set by FileModel.archive() — files without it are excluded.
   * Query params: daysOld (default "30")
   *
   * Works the same for both array and non-array configs — it targets archived
   * records only, so no disambiguation by fileId is needed.
   */
  cleanupArchived = async (
    req: AuthenticatedRequest,
    res: Response,
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
        cutoffDate.getDate() - parseInt(daysOld as string, 10),
      );

      const archivedFiles = await this.fileService.getFilesByEntity(
        this.config.entityType,
        entityId,
        { status: "archived" },
      );

      const staleIds = archivedFiles
        .filter(
          (f) =>
            f.label === this.config.label &&
            f.deletedAt != null &&
            new Date(f.deletedAt) < cutoffDate,
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
        `Failed to cleanup archived ${this.config.label}s`,
      );
    }
  };
}
