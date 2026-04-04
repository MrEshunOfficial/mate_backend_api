import { Response } from "express";
import { Types } from "mongoose";
import { CloudinaryFileService } from "../../../service/files/cloudinary.file.service";
import { MongoDBFileService } from "../../../service/files/mongodb.file.service";
import { EntityImageConfig } from "../../../types/entityConfig";
import { IFile } from "../../../types/file.types";
import { AuthenticatedRequest } from "../../../types/user.types";
import {
  handleError,
  validateObjectId,
} from "../../../utils/auth/auth.controller.utils";

// ─── Format helpers ───────────────────────────────────────────────────────────

const ALLOWED_FORMATS = ["auto", "webp", "jpg", "png"] as const;
type OptimizedFormat = (typeof ALLOWED_FORMATS)[number];

// ─── GenericCloudinaryImageHandler ───────────────────────────────────────────
//
// Handles the Cloudinary-side of image management for any entity type.
// All entity-specific behaviour (model lookups, field names, folder paths)
// is provided by the EntityImageConfig — this class never imports models.
//
// Single vs. array field behaviour is driven by config.isArray:
//   false (default) → profile picture, category cover, service cover
//                      upload retires the existing file; get/delete target the one active file
//   true            → provider gallery, client/provider id-image arrays
//                      upload accumulates; get returns all active files;
//                      delete targets a specific fileId via req.params.fileId
//
// Instantiate once per entity type in CloudinaryFileController:
//   new GenericCloudinaryImageHandler(profilePictureConfig, cloudinary, mongo)
//   new GenericCloudinaryImageHandler(providerGalleryConfig, cloudinary, mongo)

export class GenericCloudinaryImageHandler {
  constructor(
    private readonly config: EntityImageConfig,
    private readonly cloudinaryService: CloudinaryFileService,
    private readonly mongoService: MongoDBFileService,
  ) {}

  // ─── Private Helpers ──────────────────────────────────────────────────────

  /** Returns ALL active files for this config's label on the given entity. */
  private async getActiveFiles(entityId: string): Promise<IFile[]> {
    const files = await this.mongoService.getFilesByEntity(
      this.config.entityType,
      entityId,
      { status: "active" },
    );
    return files.filter((f) => f.label === this.config.label);
  }

  /**
   * Returns the single active file for non-array configs.
   * For array configs this still works — it returns the most recently
   * uploaded file, which is only used internally during the "retire existing"
   * step that is skipped for array configs anyway.
   */
  private async getActiveFile(entityId: string): Promise<IFile | null> {
    const files = await this.getActiveFiles(entityId);
    return files[0] ?? null;
  }

  /** Resolves the Cloudinary folder path for an upload. */
  private resolveUploadFolder(entityId: string, uploaderId: string): string {
    if (this.config.uploadMode === "orphan") {
      return this.config.getOrphanFolder
        ? this.config.getOrphanFolder(uploaderId)
        : `${this.config.folderPrefix}/pending/${uploaderId}`;
    }
    return this.config.getLinkedFolder
      ? this.config.getLinkedFolder(entityId)
      : `${this.config.folderPrefix}/${entityId}/${this.config.label}`;
  }

  /**
   * Core upload logic shared by `upload` (single) and `uploadMultiple` (batch).
   * Uploads one file buffer to Cloudinary, persists a MongoDB record, and
   * optionally links it to the entity.
   *
   * For array configs linkToEntity uses $addToSet — safe to call repeatedly.
   */
  private async uploadOneFile(
    file: Express.Multer.File,
    entityId: string,
    userId: string,
  ): Promise<{
    fileRecord: IFile;
    uploadResult: Awaited<ReturnType<CloudinaryFileService["uploadFile"]>>;
  }> {
    const folder = this.resolveUploadFolder(entityId, userId);

    const uploadResult = await this.cloudinaryService.uploadFile(
      file.buffer,
      file.originalname,
      {
        folderName: folder,
        isPublic: true,
        resourceType: "image",
        tags: [this.config.entityType, this.config.label, userId],
        description: `${this.config.label} image`,
        entityType: this.config.entityType,
        entityId: this.config.uploadMode === "linked" ? entityId : undefined,
        uploaderId: new Types.ObjectId(userId),
        label: this.config.label,
      },
    );

    const fileRecord = await this.mongoService.createFile({
      uploaderId: new Types.ObjectId(userId),
      url: uploadResult.secureUrl,
      fileName: uploadResult.fileName,
      fileSize: uploadResult.fileSize,
      mimeType: file.mimetype,
      extension: uploadResult.extension,
      thumbnailUrl: uploadResult.thumbnailUrl,
      storageProvider: "cloudinary",
      metadata: {
        publicId: uploadResult.publicId,
        format: uploadResult.format,
        resourceType: uploadResult.resourceType,
        width: uploadResult.width,
        height: uploadResult.height,
      },
      tags: [this.config.entityType, this.config.label, userId],
      description: `${this.config.label} image`,
      entityType: this.config.entityType,
      entityId:
        this.config.uploadMode === "linked"
          ? new Types.ObjectId(entityId)
          : undefined,
      label: this.config.label,
      status: "active",
    });

    return { fileRecord, uploadResult };
  }

  // ─── Handlers ─────────────────────────────────────────────────────────────

  /**
   * POST — upload a single image for an entity.
   *
   * Non-array (linked) mode — e.g. profile picture:
   *   Archives + removes any existing Cloudinary asset, uploads new one, links it.
   *
   * Array (linked) mode — e.g. provider gallery, client/provider id-image:
   *   Does NOT retire the existing files. Uploads and appends to the array field
   *   via $addToSet in linkToEntity.
   *
   * Orphan mode — e.g. category cover:
   *   No entityId yet; file is stored under a pending folder. Returns fileId
   *   for the caller to pass to the entity create/update handler.
   */
  upload = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res
          .status(401)
          .json({ success: false, message: "User not authenticated" });
        return;
      }

      if (!req.file) {
        res.status(400).json({ success: false, message: "No file uploaded" });
        return;
      }

      const { file } = req;

      if (!file.mimetype.startsWith("image/")) {
        res.status(400).json({
          success: false,
          message: `${this.config.label} must be an image file`,
        });
        return;
      }

      if (file.size > this.config.maxSizeBytes) {
        res.status(400).json({
          success: false,
          message: `${this.config.label} must be under ${
            this.config.maxSizeBytes / (1024 * 1024)
          } MB`,
        });
        return;
      }

      const entityId =
        this.config.uploadMode === "linked"
          ? (this.config.getEntityId(req) ?? userId)
          : userId;

      // ── Non-array linked mode: retire the one existing active file ────────
      // Array configs skip this block — each upload accumulates, never replaces.
      if (this.config.uploadMode === "linked" && !this.config.isArray) {
        const existing = await this.getActiveFile(entityId);
        if (existing) {
          if (existing.metadata?.publicId) {
            try {
              await this.cloudinaryService.deleteFile(
                existing.metadata.publicId as string,
                "image",
              );
            } catch (err) {
              console.warn(
                `[${this.config.label}] Could not delete old Cloudinary asset:`,
                err,
              );
            }
          }
          await Promise.all([
            this.config
              .unlinkFromEntity(entityId, existing._id, userId)
              .catch((err) =>
                console.warn(
                  `[${this.config.label}] unlinkFromEntity failed:`,
                  err,
                ),
              ),
            this.mongoService.archiveFile(existing._id),
          ]);
        }
      }

      // ── Upload to Cloudinary + persist MongoDB record ─────────────────────
      const { fileRecord, uploadResult } = await this.uploadOneFile(
        file,
        entityId,
        userId,
      );

      // ── Orphan mode: return fileId, optionally link if entityId provided ──
      if (this.config.uploadMode === "orphan") {
        const bodyEntityId = this.config.getEntityIdFromBody?.(req);
        let linked = false;

        if (bodyEntityId && validateObjectId(bodyEntityId)) {
          try {
            linked = await this.config.linkFileToCreatedEntity!(
              fileRecord._id,
              bodyEntityId,
              userId,
              this.mongoService,
            );
          } catch (err) {
            console.warn(
              `[${this.config.label}] linkFileToCreatedEntity failed:`,
              err,
            );
          }
        }

        res.status(200).json({
          success: true,
          message: linked
            ? `${this.config.label} uploaded and linked successfully`
            : `${this.config.label} uploaded successfully. Pass the returned fileId as ${this.config.imageFieldName} when creating or updating the entity.`,
          data: {
            fileId: fileRecord._id,
            url: uploadResult.secureUrl,
            thumbnailUrl: uploadResult.thumbnailUrl,
            width: uploadResult.width,
            height: uploadResult.height,
            linkedToEntity: linked,
          },
        });
        return;
      }

      // ── Linked mode: link to the entity document ──────────────────────────
      // For array configs, linkToEntity uses $addToSet internally.
      let linked = false;
      try {
        linked = await this.config.linkToEntity(
          entityId,
          fileRecord._id,
          userId,
        );
      } catch (err) {
        console.warn(`[${this.config.label}] linkToEntity failed:`, err);
      }

      res.status(200).json({
        success: true,
        message: linked
          ? `${this.config.label} uploaded and linked successfully`
          : `${this.config.label} uploaded. It will be linked automatically when the entity is created.`,
        data: {
          fileId: fileRecord._id,
          url: uploadResult.secureUrl,
          thumbnailUrl: uploadResult.thumbnailUrl,
          width: uploadResult.width,
          height: uploadResult.height,
          linkedToEntity: linked,
        },
      });
    } catch (error) {
      handleError(res, error, `Failed to upload ${this.config.label}`);
    }
  };

  /**
   * POST (multi) — upload several images in a single request for array-backed fields.
   *
   * Only valid when config.isArray is true (provider gallery, id-image arrays).
   * Uses req.files[] populated by multer.array().
   * Each file is uploaded independently — partial success is reported per-file.
   * No existing files are retired.
   */
  uploadMultiple = async (
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> => {
    try {
      if (!this.config.isArray) {
        res.status(400).json({
          success: false,
          message: `${this.config.label} does not support multi-file upload`,
        });
        return;
      }

      const userId = req.userId;
      if (!userId) {
        res
          .status(401)
          .json({ success: false, message: "User not authenticated" });
        return;
      }

      const files = req.files as Express.Multer.File[] | undefined;
      if (!files || files.length === 0) {
        res.status(400).json({ success: false, message: "No files uploaded" });
        return;
      }

      const maxFiles = this.config.maxFiles ?? 10;
      if (files.length > maxFiles) {
        res.status(400).json({
          success: false,
          message: `You can upload at most ${maxFiles} files at once`,
        });
        return;
      }

      // Validate every file before touching Cloudinary
      for (const file of files) {
        if (!file.mimetype.startsWith("image/")) {
          res.status(400).json({
            success: false,
            message: `All files must be images. "${file.originalname}" is not an image.`,
          });
          return;
        }
        if (file.size > this.config.maxSizeBytes) {
          res.status(400).json({
            success: false,
            message: `"${file.originalname}" exceeds the ${
              this.config.maxSizeBytes / (1024 * 1024)
            } MB limit`,
          });
          return;
        }
      }

      const entityId = this.config.getEntityId(req) ?? userId;

      // Upload all files concurrently — Cloudinary handles parallel requests fine
      const results = await Promise.allSettled(
        files.map((file) => this.uploadOneFile(file, entityId, userId)),
      );

      // Link every successfully uploaded file to the entity
      const uploaded: Array<{
        fileId: Types.ObjectId;
        url: string;
        thumbnailUrl?: string;
        width?: number;
        height?: number;
        linkedToEntity: boolean;
        fileName: string;
      }> = [];
      const failed: Array<{ fileName: string; error: string }> = [];

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const originalName = files[i].originalname;

        if (result.status === "rejected") {
          failed.push({
            fileName: originalName,
            error:
              result.reason instanceof Error
                ? result.reason.message
                : "Upload failed",
          });
          continue;
        }

        const { fileRecord, uploadResult } = result.value;
        let linked = false;
        try {
          linked = await this.config.linkToEntity(
            entityId,
            fileRecord._id,
            userId,
          );
        } catch (err) {
          console.warn(
            `[${this.config.label}] linkToEntity failed for ${originalName}:`,
            err,
          );
        }

        uploaded.push({
          fileId: fileRecord._id,
          url: uploadResult.secureUrl,
          thumbnailUrl: uploadResult.thumbnailUrl,
          width: uploadResult.width,
          height: uploadResult.height,
          linkedToEntity: linked,
          fileName: originalName,
        });
      }

      const allSucceeded = failed.length === 0;
      const anySucceeded = uploaded.length > 0;

      res.status(anySucceeded ? 200 : 500).json({
        success: anySucceeded,
        message: allSucceeded
          ? `${uploaded.length} ${this.config.label}(s) uploaded successfully`
          : `${uploaded.length} uploaded, ${failed.length} failed`,
        data: { uploaded, failed },
      });
    } catch (error) {
      handleError(res, error, `Failed to upload ${this.config.label}(s)`);
    }
  };

  /**
   * GET — returns the active image(s) for the authenticated user's own entity.
   *
   * Non-array: returns a single { fileId, url, ... } object.
   * Array:     returns { files: [ ... ] } with all active entries.
   */
  get = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
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
      handleError(res, error, `Failed to get ${this.config.label}`);
    }
  };

  /**
   * GET /:entityId — returns another entity's active image(s) (public-safe fields only).
   * Only available when config.getPublicEntityId is defined.
   *
   * Non-array: returns a single object.
   * Array:     returns { files: [ ... ] }.
   */
  getPublic = async (
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
      handleError(res, error, `Failed to get ${this.config.label}`);
    }
  };

  /**
   * DELETE — full delete: removes Cloudinary asset, unlinks from entity document,
   * and hard-deletes the MongoDB record.
   *
   * Non-array: targets the one active file.
   * Array:     requires req.params.fileId — targets a specific file in the array.
   *            Returns 400 if fileId is missing or doesn't belong to this entity.
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
        // Array mode — caller must specify which file to delete
        const { fileId } = req.params as { fileId?: string };
        if (!fileId || !validateObjectId(fileId)) {
          res.status(400).json({
            success: false,
            message:
              "fileId param is required when deleting from an array field",
          });
          return;
        }

        file = await this.mongoService.getFileById(fileId);
        if (!file) {
          res.status(404).json({ success: false, message: "File not found" });
          return;
        }

        // Verify the file actually belongs to this entity and has the right label
        if (
          file.entityId?.toString() !==
            new Types.ObjectId(entityId).toString() ||
          file.label !== this.config.label
        ) {
          res.status(403).json({
            success: false,
            message: "This file does not belong to the specified entity",
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

      if (file.metadata?.publicId) {
        await this.cloudinaryService.deleteFile(
          file.metadata.publicId as string,
          "image",
        );
      }

      await Promise.all([
        this.config.unlinkFromEntity(entityId, file._id, userId),
        this.mongoService.deleteFile(file._id),
      ]);

      res.status(200).json({
        success: true,
        message: `${this.config.label} deleted successfully`,
      });
    } catch (error) {
      handleError(res, error, `Failed to delete ${this.config.label}`);
    }
  };

  /**
   * GET /optimized — returns a Cloudinary transformation URL.
   * Query params: width (int), quality (int | "auto"), format ("auto"|"webp"|"jpg"|"png")
   *
   * For array configs, requires req.params.fileId to identify which image to optimise.
   * For non-array configs, targets the one active file.
   */
  getOptimized = async (
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

      const { width, quality, format } = req.query;

      let file: IFile | null;

      if (this.config.isArray) {
        const { fileId } = req.params as { fileId?: string };
        if (!fileId || !validateObjectId(fileId)) {
          res.status(400).json({
            success: false,
            message:
              "fileId param is required for optimized URL on an array field",
          });
          return;
        }
        file = await this.mongoService.getFileById(fileId);
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

      if (!file.metadata?.publicId) {
        res.status(400).json({
          success: false,
          message: `${this.config.label} does not have a Cloudinary public ID`,
        });
        return;
      }

      const optimizedUrl = this.cloudinaryService.getOptimizedUrl(
        file.metadata.publicId as string,
        {
          width: width ? parseInt(width as string, 10) : undefined,
          quality:
            quality === "auto"
              ? "auto"
              : quality
                ? parseInt(quality as string, 10)
                : undefined,
          format: ALLOWED_FORMATS.includes(format as OptimizedFormat)
            ? (format as OptimizedFormat)
            : undefined,
        },
      );

      res.status(200).json({
        success: true,
        data: { optimizedUrl, originalUrl: file.url },
      });
    } catch (error) {
      handleError(
        res,
        error,
        `Failed to generate optimized ${this.config.label}`,
      );
    }
  };
}
